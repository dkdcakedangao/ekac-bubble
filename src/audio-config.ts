import { promises as fs } from "node:fs";
export interface AudioTestConfig {
  output: string;
  volume: number;
  pitch: number;
  rate: number;
  unitDurationMs: number;
  text: string;
}
export function validateAudioConfig(value: any): AudioTestConfig {
  const unitDurationMs = value?.unitDurationMs ?? 100;
  if (
    !value ||
    typeof value.output !== "string" ||
    typeof value.text !== "string" ||
    value.text.length > 10000 ||
    !Number.isFinite(value.volume) ||
    value.volume < 0 ||
    value.volume > 1 ||
    !Number.isFinite(value.pitch) ||
    value.pitch < 200 ||
    value.pitch > 800 ||
    !Number.isFinite(value.rate) ||
    value.rate < 4 ||
    value.rate > 25 ||
    !Number.isFinite(unitDurationMs) ||
    unitDurationMs < 60 ||
    unitDurationMs > 400
  )
    throw Error("测试参数无效，请检查音量、音高、语速、单音节时长和文字长度");
  return {
    output: value.output,
    volume: value.volume,
    pitch: value.pitch,
    rate: value.rate,
    unitDurationMs,
    text: value.text,
  };
}
export async function saveAudioConfig(path: string, value: unknown) {
  const config = validateAudioConfig(value);
  await fs.writeFile(path + ".tmp", JSON.stringify(config, null, 2), "utf8");
  await fs.rename(path + ".tmp", path);
  return config;
}
export async function loadAudioConfig(path: string, defaults: AudioTestConfig) {
  let content: string;
  try {
    content = await fs.readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return saveAudioConfig(path, defaults);
    throw e;
  }
  return validateAudioConfig(JSON.parse(content));
}

// Combine edits while keeping acknowledgement tied to the batch actually written.
export class AudioConfigWriter {
  private pending: AudioTestConfig | null = null;
  private waiters: Array<{
    resolve: () => void;
    reject: (e: unknown) => void;
  }> = [];
  private timer?: ReturnType<typeof setTimeout>;
  private running: Promise<void> | null = null;
  private failure: unknown = null;
  constructor(
    private path: string,
    private write: (
      path: string,
      config: AudioTestConfig,
    ) => Promise<AudioTestConfig> = saveAudioConfig,
  ) {}
  update(value: unknown): Promise<void> {
    const config = validateAudioConfig(value);
    this.pending = config;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 250);
    return new Promise((resolve, reject) =>
      this.waiters.push({ resolve, reject }),
    );
  }
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.running) {
      await this.running;
      return this.flush();
    }
    if (!this.pending) {
      if (this.failure) throw this.failure;
      return;
    }
    this.running = (async () => {
      while (this.pending) {
        const config = this.pending,
          waiters = this.waiters;
        this.pending = null;
        this.waiters = [];
        try {
          await this.write(this.path, config);
          this.failure = null;
          for (const w of waiters) w.resolve();
        } catch (e) {
          this.failure = e;
          for (const w of waiters) w.reject(e);
        }
      }
      if (this.failure) throw this.failure;
    })();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }
}
