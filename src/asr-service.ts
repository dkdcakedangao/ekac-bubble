import { utilityProcess, type UtilityProcess } from "electron";
import { join } from "node:path";
export class AsrService {
  private child: UtilityProcess | null = null;
  private ready = false;
  private starting: Promise<void> | null = null;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  constructor(
    private root: string,
    private status: (s: string) => void,
  ) {}
  get pid() {
    return this.child?.pid ?? null;
  }
  private request(kind: string, data: any = {}) {
    const child = this.child;
    if (!child) return Promise.reject(Error("识别进程已停止"));
    const id = ++this.sequence;
    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.postMessage({ id, kind, ...data });
    });
  }
  async load(dir: string) {
    if (this.ready) return;
    if (this.starting) return this.starting;
    const child = (this.child = utilityProcess.fork(
      join(this.root, "dist/asr-worker.cjs"),
      [],
      { serviceName: "ekac-bubble 语音识别" },
    ));
    child.on("message", (message) => {
      if (child !== this.child) return;
      if (message.status) {
        this.status(message.status);
        return;
      }
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id);
      message.error
        ? item.reject(Error(message.error))
        : item.resolve(message.value);
    });
    child.on("exit", () => {
      if (child !== this.child) return;
      this.stop();
      this.status("识别进程已退出，可重新开始监听");
    });
    const operation = this.request("load", { dir }).then(() => {
      if (this.child !== child) throw Error("识别加载已取消");
      this.ready = true;
    });
    this.starting = operation;
    try {
      await operation;
    } catch (error) {
      if (this.child === child) this.stop();
      throw error;
    } finally {
      if (this.starting === operation) this.starting = null;
    }
  }
  decode(pcm: Int16Array) {
    return this.request("decode", {
      pcm: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
    });
  }
  stop() {
    const child = this.child;
    this.child = null;
    this.ready = false;
    this.starting = null;
    for (const item of this.pending.values())
      item.reject(Error("识别请求已取消"));
    this.pending.clear();
    child?.kill();
  }
}
