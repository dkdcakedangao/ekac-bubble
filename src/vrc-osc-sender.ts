import dgram from "node:dgram";
import type { BubbleChunk } from "./vrc-bubble-layout";

export interface OscArg {
  type: "i" | "f" | "b";
  value: number | boolean;
}

export function oscString(s: string): Buffer {
  const b = Buffer.from(s + "\0", "utf8");
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
}

export function encodeOscMessage(address: string, args: OscArg[]): Buffer {
  let tags = ",";
  const chunks: Buffer[] = [];
  for (const arg of args) {
    if (arg.type === "i") {
      tags += "i";
      const buf = Buffer.allocUnsafe(4);
      buf.writeInt32BE(Math.trunc(Number(arg.value)), 0);
      chunks.push(buf);
    } else if (arg.type === "f") {
      tags += "f";
      const buf = Buffer.allocUnsafe(4);
      buf.writeFloatBE(Number(arg.value), 0);
      chunks.push(buf);
    } else {
      tags += arg.value ? "T" : "F";
    }
  }
  return Buffer.concat([oscString(address), oscString(tags), ...chunks]);
}

export interface VrcOscSenderOptions {
  host?: string;
  port?: number;
  sliceIntervalMs?: number;
  repairIntervalMs?: number;
  repairPasses?: number;
  clearResetMs?: number;
  onError?: (error: Error) => void;
}

export class VrcBubbleOscSender {
  private socket = dgram.createSocket("udp4");
  private closed = false;
  private gen = 0; // 1..15 active, 0 cleared
  private seq = 0; // 1..7 active, 0 init
  private timer?: ReturnType<typeof setTimeout>;
  private clearTimer?: ReturnType<typeof setTimeout>;
  private activeToken = 0;

  private readonly host: string;
  private readonly port: number;
  private readonly sliceIntervalMs: number;
  private readonly repairIntervalMs: number;
  private readonly repairPasses: number;
  readonly clearResetMs: number;
  private readonly onError?: (error: Error) => void;

  constructor(opts: VrcOscSenderOptions = {}) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port ?? 9000;
    this.sliceIntervalMs = opts.sliceIntervalMs ?? 120;
    this.repairIntervalMs = opts.repairIntervalMs ?? 200;
    this.repairPasses = opts.repairPasses ?? 2;
    this.clearResetMs = Math.max(50, opts.clearResetMs ?? 400);
    this.onError = opts.onError;
    this.socket.on("error", (err) => this.handleError("socket", err));
  }

  private handleError(context: string, err: Error) {
    if (this.closed) return;
    if (this.onError) this.onError(err);
    else console.error(`[VrcBubbleOscSender] ${context}:`, err.message);
  }

  private sendParam(name: string, arg: OscArg) {
    if (this.closed) return;
    const pkt = encodeOscMessage(`/avatar/parameters/${name}`, [arg]);
    this.socket.send(pkt, this.port, this.host, (err) => {
      if (err) this.handleError(name, err);
    });
  }

  private sendSlicePacket(
    chunk: BubbleChunk,
    sliceIndex: number,
    genValue: number,
    seqValue: number,
  ) {
    const base = sliceIndex * 3;
    const g0 = chunk.glyphs[base] ?? { col: 0, row: 0 };
    const g1 = chunk.glyphs[base + 1] ?? { col: 0, row: 0 };
    const g2 = chunk.glyphs[base + 2] ?? { col: 0, row: 0 };

    // Send payload fields BEFORE Gen and Seq so receivers never sample partial headers.
    this.sendParam("EB_Clear", { type: "b", value: false });
    this.sendParam("EB_C0_Col", { type: "i", value: g0.col });
    this.sendParam("EB_C0_Row", { type: "i", value: g0.row });
    this.sendParam("EB_C1_Col", { type: "i", value: g1.col });
    this.sendParam("EB_C1_Row", { type: "i", value: g1.row });
    this.sendParam("EB_C2_Col", { type: "i", value: g2.col });
    this.sendParam("EB_C2_Row", { type: "i", value: g2.row });
    this.sendParam("EB_Slice", { type: "i", value: sliceIndex });
    this.sendParam("EB_Len", { type: "i", value: chunk.len });
    this.sendParam("EB_Line1", { type: "i", value: chunk.line1Len });
    this.sendParam("EB_Gen", { type: "i", value: genValue });
    this.sendParam("EB_Seq", { type: "i", value: seqValue });
  }

  private stopTimers() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = undefined;
    }
  }

  showChunk(chunk: BubbleChunk) {
    if (this.closed || chunk.len <= 0) return;
    this.stopTimers();
    const token = ++this.activeToken;
    // Matches Unity Receiver FSM: EB_Gen 1..7 (3-bit), EB_Seq 1..3 (2-bit), Col 6-bit (0..63), Row 7-bit (0..127)
    this.gen = (this.gen % 7) + 1;
    const currentGen = this.gen;
    const numSlices = Math.max(1, Math.min(8, Math.ceil(chunk.len / 3)));

    const step = (idx: number, pass: number) => {
      if (this.closed || token !== this.activeToken) return;
      this.seq = (this.seq % 3) + 1;
      this.sendSlicePacket(chunk, idx, currentGen, this.seq);

      let nextIdx = idx + 1;
      let nextPass = pass;
      if (nextIdx >= numSlices) {
        nextIdx = 0;
        nextPass++;
      }
      if (nextPass > this.repairPasses) return;

      const delay = nextPass === 0 ? this.sliceIntervalMs : this.repairIntervalMs;
      this.timer = setTimeout(() => step(nextIdx, nextPass), delay);
    };

    step(0, 0);
  }

  clearAll() {
    if (this.closed) return;
    this.stopTimers();
    const token = ++this.activeToken;
    this.gen = 0;
    this.sendParam("EB_Len", { type: "i", value: 0 });
    this.sendParam("EB_Line1", { type: "i", value: 0 });
    this.sendParam("EB_Gen", { type: "i", value: 0 });
    this.sendParam("EB_Clear", { type: "b", value: true });
    this.clearTimer = setTimeout(() => {
      if (this.closed || token !== this.activeToken) return;
      this.sendParam("EB_Clear", { type: "b", value: false });
    }, this.clearResetMs);
  }

  close() {
    if (this.closed) return;
    this.stopTimers();
    this.closed = true;
    try {
      this.socket.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ERR_SOCKET_DGRAM_NOT_RUNNING") {
        throw error;
      }
    }
  }
}
