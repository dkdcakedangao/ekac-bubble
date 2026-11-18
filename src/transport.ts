import dgram from "node:dgram";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "node:crypto";
export function oscString(s: string) {
  const b = Buffer.from(s + "\0");
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
}
export function chatPacket(text: string) {
  return Buffer.concat([
    oscString("/chatbox/input"),
    oscString(",sTF"),
    oscString(text),
  ]);
}
export function chunks(text: string, limit = 144) {
  const out: string[] = [];
  let part = "";
  for (const sentence of text.match(
    /[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/gu,
  ) ?? []) {
    for (const ch of sentence) {
      if ([...part].length >= limit) {
        out.push(part);
        part = "";
      }
      part += ch;
    }
    if (part) {
      out.push(part);
      part = "";
    }
  }
  return out;
}
export class Chatbox {
  private socket = dgram.createSocket("udp4");
  private generation = 0;
  private last = 0;
  private tail = Promise.resolve();
  constructor(
    private host = "127.0.0.1",
    private port = 9000,
  ) {}
  cancel() {
    this.generation++;
  }
  send(text: string) {
    const g = this.generation;
    const next = this.tail.then(() => this.sendParts(text, g));
    this.tail = next.catch(() => {});
    return next;
  }
  private async sendParts(text: string, g: number) {
    for (const part of chunks(text)) {
      await new Promise((r) =>
        setTimeout(r, Math.max(0, this.last + 1500 - Date.now())),
      );
      if (g !== this.generation) return;
      await new Promise<void>((resolve, reject) =>
        this.socket.send(chatPacket(part), this.port, this.host, (e) =>
          e ? reject(e) : resolve(),
        ),
      );
      this.last = Date.now();
    }
  }
  async clear() {
    this.cancel();
    await new Promise<void>((resolve, reject) =>
      this.socket.send(chatPacket(""), this.port, this.host, (e) =>
        e ? reject(e) : resolve(),
      ),
    );
    this.last = Date.now();
  }
  async stop() {
    this.cancel();
    await this.tail.catch(() => {});
    this.close();
  }
  close() {
    try {
      this.socket.close();
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ERR_SOCKET_DGRAM_NOT_RUNNING"
      )
        throw error;
    }
  }
}
export class ModelPort {
  readonly token = randomBytes(24).toString("hex");
  private server?: WebSocketServer;
  private snapshot: any = null;
  private clients = new Set<WebSocket>();
  start(port = 9011) {
    return new Promise<void>((resolve, reject) => {
      const server = (this.server = new WebSocketServer({
        host: "127.0.0.1",
        port,
        maxPayload: 4096,
      }));
      server.once("error", reject);
      server.once("listening", resolve);
      server.on("connection", (ws, req) => {
        if (
          new URL(req.url ?? "/", "http://localhost").searchParams.get(
            "token",
          ) !== this.token
        ) {
          ws.close(1008, "Unauthorized");
          return;
        }
        this.clients.add(ws);
        ws.on("close", () => this.clients.delete(ws));
        ws.send(
          JSON.stringify({ v: 1, type: "snapshot", state: this.snapshot }),
        );
      });
    });
  }
  publish(event: any) {
    if (event.type === "begin") this.snapshot = { ...event, count: 0 };
    else if (event.type === "reveal" && this.snapshot?.id === event.id)
      this.snapshot = {
        ...this.snapshot,
        count: event.count,
        elapsedMs: event.elapsedMs,
      };
    else if (event.type === "end" && this.snapshot?.id === event.id)
      this.snapshot = { ...this.snapshot, ended: true };
    else if (event.type === "cancel" && this.snapshot?.id === event.id)
      this.snapshot = null;
    const data = JSON.stringify({ v: 1, ...event });
    for (const ws of this.clients)
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
  async close() {
    this.snapshot = null;
    for (const ws of this.clients) ws.terminate();
    this.clients.clear();
    const server = this.server;
    this.server = undefined;
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
