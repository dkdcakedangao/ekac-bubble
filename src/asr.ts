import { createRequire } from "node:module";
const loadNative = createRequire(import.meta.url);
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  promises as fs,
} from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
const FILES = [
  {
    name: "model.int8.onnx",
    hash: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
  },
  {
    name: "tokens.txt",
    hash: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
  },
];
const ROOTS = [
  "https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/",
  "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/",
];
async function hash(path: string) {
  const h = createHash("sha256");
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest("hex");
}
export class Asr {
  private rec: any;
  private busy = Promise.resolve();
  constructor(
    public dir: string,
    private status: (s: string) => void,
  ) {}
  async download() {
    await fs.mkdir(this.dir, { recursive: true });
    for (const f of FILES) {
      const dest = join(this.dir, f.name);
      if (existsSync(dest) && (await hash(dest)) === f.hash) continue;
      let success = false;
      for (const root of ROOTS) {
        const temp = dest + ".part";
        try {
          const response = await fetch(root + f.name, {
            signal: AbortSignal.timeout(300000),
          });
          if (!response.ok || !response.body)
            throw Error("HTTP " + response.status);
          let got = 0,
            last = 0;
          const total = Number(response.headers.get("content-length"));
          const progress = new Transform({
            transform: (b, _, done) => {
              got += b.length;
              if (Date.now() - last > 500) {
                last = Date.now();
                this.status(
                  `${f.name}：${(got / 1048576).toFixed(1)} MB${total ? " / " + (total / 1048576).toFixed(1) + " MB" : ""}`,
                );
              }
              done(null, b);
            },
          });
          await pipeline(
            Readable.fromWeb(response.body as any),
            progress,
            createWriteStream(temp),
          );
          if ((await hash(temp)) !== f.hash) throw Error("SHA-256 校验失败");
          await fs.rename(temp, dest);
          success = true;
          break;
        } catch (e) {
          await fs.rm(temp, { force: true });
          this.status("下载失败：" + (e as Error).message);
        }
      }
      if (!success) throw Error("模型下载失败，请选择已有模型目录");
    }
  }
  async verify() {
    this.status("正在校验模型…");
    for (const f of FILES) {
      const path = join(this.dir, f.name);
      if (!existsSync(path)) throw Error("缺少 " + f.name);
      if ((await hash(path)) !== f.hash) throw Error(f.name + " 校验失败");
    }
  }
  async load() {
    await this.verify();
    const sherpa = loadNative("sherpa-onnx-node");
    this.rec = await sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        senseVoice: {
          model: join(this.dir, "model.int8.onnx"),
          language: "auto",
          useInverseTextNormalization: 1,
        },
        tokens: join(this.dir, "tokens.txt"),
        numThreads: 2,
        provider: "cpu",
        debug: 0,
      },
    });
    this.status("SenseVoiceSmall 已就绪（CPU，2 线程）");
  }
  async decode(pcm: Int16Array) {
    let loud = false;
    for (let at = 0; at < pcm.length; at += 320) {
      let sum = 0;
      const end = Math.min(at + 320, pcm.length);
      for (let j = at; j < end; j++) sum += (pcm[j] / 32768) ** 2;
      if (Math.sqrt(sum / Math.max(1, end - at)) >= 0.001) {
        loud = true;
        break;
      }
    }
    if (!loud) return "";
    let release!: () => void;
    const before = this.busy;
    this.busy = new Promise<void>((r) => (release = r));
    await before;
    try {
      if (!this.rec) throw Error("请先加载识别模型");
      const samples = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
      const stream = this.rec.createStream();
      stream.acceptWaveform({ sampleRate: 16000, samples });
      const result = await this.rec.decodeAsync(stream);
      return String(result.text ?? "").trim();
    } finally {
      release();
    }
  }
}
