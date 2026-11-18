import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSpeech,
  DEFAULT_UNIT_DURATION_MS,
  MIN_UNIT_DURATION_MS,
  MAX_UNIT_DURATION_MS,
  VOICE_GAP,
} from "../web/speech.js";

class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(ch: number): Float32Array {
    return this.channels[ch];
  }
}

class FakeAudioParam {
  value: number;
  curve: { values: Float32Array; startTime: number; duration: number } | null = null;

  constructor(value: number) {
    this.value = value;
  }

  setValueCurveAtTime(values: Float32Array, startTime: number, duration: number) {
    this.curve = { values: new Float32Array(values), startTime, duration };
  }

  sampleAt(t: number): number {
    if (!this.curve) return this.value;
    const { values, startTime, duration } = this.curve;
    if (values.length === 0) return this.value;
    if (duration <= 0 || t <= startTime) return values[0];
    if (t >= startTime + duration) return values[values.length - 1];
    const norm = ((t - startTime) / duration) * (values.length - 1);
    const i0 = Math.floor(norm);
    const i1 = Math.min(values.length - 1, i0 + 1);
    const frac = norm - i0;
    return values[i0] + (values[i1] - values[i0]) * frac;
  }
}

class FakeGainNode {
  gain = new FakeAudioParam(1);
  connected: unknown = null;
  connect(dest: unknown) {
    this.connected = dest;
  }
}

class FakeBufferSourceNode {
  buffer: FakeAudioBuffer | null = null;
  playbackRate = new FakeAudioParam(1);
  onended: (() => void) | null = null;
  startTime = 0;
  stopTime = Infinity;
  started = false;
  stopped = false;
  gainNode: FakeGainNode | null = null;

  connect(dest: unknown) {
    if (dest instanceof FakeGainNode) this.gainNode = dest;
  }

  start(when = 0) {
    this.started = true;
    this.startTime = when;
  }

  stop(when = Infinity) {
    if (when <= this.startTime || arguments.length === 0) {
      this.stopped = true;
      this.stopTime = when;
      this.onended?.();
      return;
    }
    this.stopTime = Math.min(this.stopTime, when);
  }
}

class FakeAudioContext {
  readonly sampleRate: number;
  currentTime = 0;
  readonly master = new FakeGainNode();
  readonly sources: FakeBufferSourceNode[] = [];
  private readonly bankBuffer: FakeAudioBuffer;

  constructor(bankBuffer: FakeAudioBuffer, sampleRate = 48000) {
    this.bankBuffer = bankBuffer;
    this.sampleRate = sampleRate;
  }

  async decodeAudioData() {
    return this.bankBuffer;
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }

  createBufferSource() {
    const src = new FakeBufferSourceNode();
    this.sources.push(src);
    return src;
  }

  createGain() {
    return new FakeGainNode();
  }

  advanceTo(t: number) {
    this.currentTime = t;
    for (const s of this.sources) {
      if (!s.stopped && s.started && s.stopTime <= t) {
        s.stopped = true;
        s.onended?.();
      }
    }
  }

  /** Renders active (non-cancelled) scheduled sources into a physical PCM timeline. */
  render(totalSec: number): Float32Array {
    const len = Math.ceil(totalSec * this.sampleRate);
    const out = new Float32Array(len);
    for (const src of this.sources) {
      if (src.stopped && !Number.isFinite(src.stopTime)) continue;
      if (!src.buffer || !src.started) continue;
      const buf = src.buffer.getChannelData(0);
      const gain = src.gainNode?.gain.value ?? 1;
      const startSample = Math.max(0, Math.round(src.startTime * this.sampleRate));
      const endSample = Math.min(
        len,
        Number.isFinite(src.stopTime) ? Math.round(src.stopTime * this.sampleRate) : len,
      );
      let readPos = 0;
      const ratio = src.buffer.sampleRate / this.sampleRate;
      for (let i = startSample; i < endSample; i++) {
        if (readPos >= buf.length - 1) break;
        const i0 = Math.floor(readPos);
        const frac = readPos - i0;
        const v = buf[i0] + (buf[i0 + 1] - buf[i0]) * frac;
        out[i] += v * gain;
        const t = i / this.sampleRate;
        readPos += src.playbackRate.sampleAt(t) * ratio;
      }
    }
    return out;
  }
}

/**
 * Builds a synthetic bank mimicking web/speech/zh.ogg:
 * - 20 ms attenuated consonant-like transient
 * - 65 ms steady voiced 364 Hz sine wave
 * - 30 ms cosine fade-out
 * Separated by high-frequency (3500 Hz) crosstalk trap bands outside [off, off + len].
 */
function buildSyntheticBank(sampleRate = 48000, bankHz = 364) {
  const unitLen = 0.115;
  const gapLen = 0.06;
  const keys = ["ni", "hao", "shi", "jie", "a", "ba"];
  const totalSec = gapLen + keys.length * (unitLen + gapLen);
  const buf = new FakeAudioBuffer(1, Math.round(totalSec * sampleRate), sampleRate);
  const data = buf.getChannelData(0);

  // Fill entire buffer with a 3500 Hz sentinel tone so any out-of-bounds read leaks high frequency.
  for (let i = 0; i < data.length; i++) {
    data[i] = 0.8 * Math.sin((2 * Math.PI * 3500 * i) / sampleRate);
  }

  const units: Record<string, [number, number]> = {};
  let cursor = gapLen;
  for (const key of keys) {
    const startIdx = Math.round(cursor * sampleRate);
    const n = Math.round(unitLen * sampleRate);
    const consSamples = Math.round(0.015 * sampleRate);
    const transSamples = Math.round(0.005 * sampleRate);
    const fadeIn = Math.round(0.008 * sampleRate);
    const fadeOut = Math.round(0.03 * sampleRate);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      let s = Math.sin(2 * Math.PI * bankHz * t);
      if (i < consSamples) {
        s *= 0.56;
      } else if (i < consSamples + transSamples) {
        const p = (i - consSamples) / transSamples;
        s *= 0.56 + 0.44 * p;
      }
      if (i < fadeIn) s *= (i / fadeIn) ** 2;
      if (i >= n - fadeOut) {
        const p = (i - (n - fadeOut)) / fadeOut;
        s *= Math.cos((Math.PI / 2) * p);
      }
      data[startIdx + i] = s * 0.7;
    }
    units[key] = [cursor, unitLen];
    cursor += unitLen + gapLen;
  }

  const manifestBytes = Buffer.from(JSON.stringify({ hz: bankHz, units }), "utf8");
  return { buf, manifestBytes, units, bankHz };
}

async function setupSpeech(bank = buildSyntheticBank()) {
  const ctx = new FakeAudioContext(bank.buf);
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith(".json")) {
      return new Response(bank.manifestBytes, { status: 200 });
    }
    return new Response(new Uint8Array(8), { status: 200 });
  }) as typeof fetch;

  let mapFn = (text: string) => {
    const chars = [...text];
    const gaps = VOICE_GAP as Record<string, number>;
    const spoken = chars
      .map((ch, at) => ({ ch, at }))
      .filter((x) => gaps[x.ch] === undefined);
    return spoken.map((x, idx) => ({
      at: x.at,
      key: x.ch === "好" ? "hao" : "ni",
      tone: 0,
      weak: false,
      stress: false,
      pos: idx,
      of: spoken.length,
      end: "",
    }));
  };

  const speech = createSpeech(
    { output: () => ({ ctx, master: ctx.master }) },
    {
      base: "http://local.test/speech/",
      unitsOf: async (text: string) => mapFn(text),
    },
  );

  speech.configure({ enabled: true });
  // Trigger initial fetch + decodeAudioData
  speech.active;
  await new Promise((r) => setTimeout(r, 10));
  speech.active;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(speech.active, true);

  return {
    ctx,
    speech,
    setUnitsMapper(fn: typeof mapFn) {
      mapFn = fn;
    },
    cleanup() {
      speech.stop();
      globalThis.fetch = origFetch;
    },
  };
}

function measureRms(arr: Float32Array, from: number, to: number): number {
  const a = Math.max(0, from);
  const b = Math.min(arr.length, to);
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += arr[i] * arr[i];
  return Math.sqrt(sum / (b - a));
}

function estimateFreqZeroCrossings(arr: Float32Array, sampleRate: number, fromSec: number, toSec: number): number {
  const a = Math.max(0, Math.round(fromSec * sampleRate));
  const b = Math.min(arr.length, Math.round(toSec * sampleRate));
  let crossings = 0;
  for (let i = a + 1; i < b; i++) {
    if ((arr[i - 1] < 0 && arr[i] >= 0) || (arr[i - 1] >= 0 && arr[i] < 0)) {
      crossings++;
    }
  }
  const dur = (b - a) / sampleRate;
  return crossings / (2 * dur);
}

function measureActiveSpanSec(arr: Float32Array, sampleRate: number): { startSec: number; endSec: number; spanSec: number } {
  let peak = 0;
  for (let i = 0; i < arr.length; i++) {
    const a = Math.abs(arr[i]);
    if (a > peak) peak = a;
  }
  const thresh = peak * 0.05;
  let first = -1, last = -1;
  for (let i = 0; i < arr.length; i++) {
    if (Math.abs(arr[i]) > thresh) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return { startSec: 0, endSec: 0, spanSec: 0 };
  return {
    startSec: first / sampleRate,
    endSec: last / sampleRate,
    spanSec: (last - first) / sampleRate,
  };
}

test("defaults to 100 ms and clamps unitDurationMs to 60..400 ms", async () => {
  const env = await setupSpeech();
  try {
    assert.equal(DEFAULT_UNIT_DURATION_MS, 100);
    assert.equal(MIN_UNIT_DURATION_MS, 60);
    assert.equal(MAX_UNIT_DURATION_MS, 400);

    // Default (100 ms)
    env.speech.begin("你");
    env.speech.reveal(0);
    await new Promise((r) => setTimeout(r, 10));
    let s = env.ctx.sources[env.ctx.sources.length - 1];
    assert.ok(Math.abs(s.stopTime - s.startTime - 0.1) < 1e-6);

    // Below minimum -> clamped to 60 ms
    env.speech.stop();
    env.speech.configure({ unitDurationMs: 10 });
    env.speech.begin("好");
    env.speech.reveal(0);
    await new Promise((r) => setTimeout(r, 10));
    s = env.ctx.sources[env.ctx.sources.length - 1];
    assert.ok(Math.abs(s.stopTime - s.startTime - 0.06) < 1e-6);

    // Above maximum -> clamped to 400 ms
    env.speech.stop();
    env.speech.configure({ unitDurationMs: 999 });
    env.speech.begin("你");
    env.speech.reveal(0);
    await new Promise((r) => setTimeout(r, 10));
    s = env.ctx.sources[env.ctx.sources.length - 1];
    assert.ok(Math.abs(s.stopTime - s.startTime - 0.4) < 1e-6);

    // NaN ignored (keeps 400 ms)
    env.speech.stop();
    env.speech.configure({ unitDurationMs: Number.NaN });
    env.speech.begin("好");
    env.speech.reveal(0);
    await new Promise((r) => setTimeout(r, 10));
    s = env.ctx.sources[env.ctx.sources.length - 1];
    assert.ok(Math.abs(s.stopTime - s.startTime - 0.4) < 1e-6);
  } finally {
    env.cleanup();
  }
});

test("60/160/400 ms durations remain independent across 200/400/800 Hz pitches with continuous energy", async () => {
  const durations = [60, 160, 400];
  const pitches = [200, 400, 800];

  for (const durMs of durations) {
    for (const pitchHz of pitches) {
      const env = await setupSpeech();
      try {
        env.speech.configure({ unitDurationMs: durMs, pitchHz, unitsPerSecond: 13 });
        env.speech.begin("你");
        env.speech.reveal(0);
        await new Promise((r) => setTimeout(r, 10));

        const src = env.ctx.sources[0];
        assert.ok(src, `expected scheduled source for ${durMs}ms @ ${pitchHz}Hz`);
        const scheduledDur = src.stopTime - src.startTime;
        assert.ok(
          Math.abs(scheduledDur - durMs / 1000) < 1e-6,
          `scheduled duration ${scheduledDur} should match ${durMs / 1000}`,
        );

        const pcm = env.ctx.render(src.startTime + scheduledDur + 0.05);
        const span = measureActiveSpanSec(pcm, env.ctx.sampleRate);
        // Active envelope (above 5% peak) should span nearly the entire target duration (allowing fade-in/out).
        assert.ok(
          span.spanSec >= (durMs / 1000) * 0.72 && span.spanSec <= (durMs / 1000) + 0.005,
          `active audio span ${span.spanSec}s mismatch for ${durMs}ms @ ${pitchHz}Hz`,
        );

        // Verify pitch via zero-crossing rate in the voiced middle section (no 3500 Hz crosstalk!).
        const midStart = src.startTime + (durMs / 1000) * 0.35;
        const midEnd = src.startTime + (durMs / 1000) * 0.75;
        const estHz = estimateFreqZeroCrossings(pcm, env.ctx.sampleRate, midStart, midEnd);
        assert.ok(
          estHz >= pitchHz * 0.85 && estHz <= pitchHz * 1.15,
          `estimated pitch ${estHz.toFixed(1)} Hz should be near ${pitchHz} Hz at ${durMs}ms`,
        );

        // Verify continuous energy across the extended body (not zero-padded tail).
        const s0 = Math.round(src.startTime * env.ctx.sampleRate);
        const totalSamples = Math.round((durMs / 1000) * env.ctx.sampleRate);
        const q1Rms = measureRms(pcm, s0 + Math.round(totalSamples * 0.25), s0 + Math.round(totalSamples * 0.45));
        const q3Rms = measureRms(pcm, s0 + Math.round(totalSamples * 0.55), s0 + Math.round(totalSamples * 0.78));
        assert.ok(q1Rms > 0.05 && q3Rms > q1Rms * 0.55, `tail RMS ${q3Rms} dropped unexpectedly vs ${q1Rms}`);

        // Verify no boundary click (max sample-to-sample jump stays smooth).
        let maxDiff = 0;
        for (let i = 1; i < pcm.length; i++) {
          const d = Math.abs(pcm[i] - pcm[i - 1]);
          if (d > maxDiff) maxDiff = d;
        }
        // Max sample step for an 800 Hz sine of amplitude ~0.35 at 48 kHz is ~0.037.
        assert.ok(maxDiff < 0.08, `unexpected click discontinuity maxDiff=${maxDiff} at ${durMs}ms @ ${pitchHz}Hz`);
      } finally {
        env.cleanup();
      }
    }
  }
});

test("queuing prevents overlap, drops nothing on long units, respects unitsPerSecond and punctuation gaps", async () => {
  const env = await setupSpeech();
  try {
    // 400 ms units with high unitsPerSecond (13): spacing must be >= 400 ms (no stacking/dropping).
    env.speech.configure({ unitDurationMs: 400, pitchHz: 400, unitsPerSecond: 13 });
    env.speech.begin("你好你好");
    for (let i = 0; i < 4; i++) env.speech.reveal(i);
    await new Promise((r) => setTimeout(r, 15));

    assert.equal(env.ctx.sources.length, 4, "no syllables should be dropped by lag");
    for (let i = 1; i < env.ctx.sources.length; i++) {
      const prev = env.ctx.sources[i - 1];
      const curr = env.ctx.sources[i];
      assert.ok(curr.startTime >= prev.stopTime - 1e-9, `unit ${i} overlapped previous unit`);
      assert.ok(curr.startTime - prev.startTime >= 0.4 - 1e-9);
    }

    // Short 60 ms units with low unitsPerSecond (5 -> 200 ms): spacing must be >= 200 ms.
    env.speech.stop();
    env.speech.configure({ unitDurationMs: 60, unitsPerSecond: 5 });
    env.speech.begin("你好");
    env.speech.reveal(0);
    env.speech.reveal(1);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(env.ctx.sources.length, 6);
    const short0 = env.ctx.sources[4];
    const short1 = env.ctx.sources[5];
    assert.ok(short1.startTime - short0.startTime >= 0.2 - 1e-9);

    // Punctuation gaps preserved after unit finishes.
    env.speech.stop();
    env.speech.configure({ unitDurationMs: 250, unitsPerSecond: 13 });
    env.speech.begin("你，好。");
    for (let i = 0; i < 4; i++) env.speech.reveal(i);
    await new Promise((r) => setTimeout(r, 10));
    const p0 = env.ctx.sources[6];
    const p1 = env.ctx.sources[7];
    assert.ok(
      p1.startTime >= p0.stopTime + VOICE_GAP["，"] - 1e-9,
      `comma gap not preserved: ${p1.startTime} vs ${p0.stopTime + VOICE_GAP["，"]}`,
    );

    // Before trailing period gap elapses, idle must remain false even after audio ends.
    env.ctx.advanceTo(p1.stopTime + 0.05);
    assert.equal(env.speech.idle, false);
    env.ctx.advanceTo(p1.stopTime + VOICE_GAP["。"] + 0.05);
    assert.equal(env.speech.idle, true);
  } finally {
    env.cleanup();
  }
});

test("stop() clears active nodes, pending timers, and restores idle state", async () => {
  const env = await setupSpeech();
  try {
    assert.equal(env.speech.idle, true);

    // Pending unitsOf keeps idle === false until resolved or stopped.
    let resolvePending!: (u: unknown[]) => void;
    const origMapper = env.setUnitsMapper;
    void origMapper;
    const customSpeech = createSpeech(
      { output: () => ({ ctx: env.ctx, master: env.ctx.master }) },
      {
        base: "http://local.test/speech/",
        unitsOf: () => new Promise((res) => { resolvePending = res as (u: unknown[]) => void; }),
      },
    );
    customSpeech.configure({ enabled: true });
    customSpeech.begin("等");
    assert.equal(customSpeech.idle, false);
    customSpeech.stop();
    assert.equal(customSpeech.idle, true);
    resolvePending([]);

    let unitCallbacks = 0;
    const countedSpeech = createSpeech(
      { output: () => ({ ctx: env.ctx, master: env.ctx.master }) },
      {
        base: "http://local.test/speech/",
        onUnit: () => { unitCallbacks++; },
        unitsOf: async (text: string) =>
          [...text].map((_, at) => ({ at, key: "ni", tone: 0, weak: false, stress: false, pos: at, of: text.length, end: "" })),
      },
    );
    countedSpeech.configure({ enabled: true, unitDurationMs: 300 });
    countedSpeech.active;
    await new Promise((r) => setTimeout(r, 10));
    countedSpeech.active;
    await new Promise((r) => setTimeout(r, 10));

    const beforeCount = env.ctx.sources.length;
    countedSpeech.begin("你好世界");
    for (let i = 0; i < 4; i++) countedSpeech.reveal(i);
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(countedSpeech.idle, false);
    assert.equal(env.ctx.sources.length - beforeCount, 4);

    countedSpeech.stop();
    assert.equal(countedSpeech.idle, true);
    for (let i = beforeCount; i < env.ctx.sources.length; i++) {
      assert.equal(env.ctx.sources[i].stopped, true, "all playing/queued nodes must be stopped");
    }
    const callbacksAtStop = unitCallbacks;
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(unitCallbacks, callbacksAtStop, "cleared timers must not fire after stop()");
  } finally {
    env.cleanup();
  }
});

test("bounded synthesis cache handles many distinct keys/durations without error", async () => {
  const env = await setupSpeech();
  try {
    const keys = ["ni", "hao", "shi", "jie", "a", "ba"];
    env.setUnitsMapper((text) =>
      [...text].map((_, at) => ({
        at,
        key: keys[at % keys.length],
        tone: (at % 4) + 1,
        weak: false,
        stress: false,
        pos: at,
        of: text.length,
        end: "",
      })),
    );

    // Cycle > 80 distinct duration/pitch combinations across syllables (exceeding BUFFER_CACHE_LIMIT=64).
    for (let step = 0; step < 80; step++) {
      const dur = 60 + ((step * 5) % 341);
      env.speech.configure({ unitDurationMs: dur, pitchHz: 200 + (step % 6) * 100 });
      env.speech.begin(`字${step}`);
      env.speech.reveal(0);
      await new Promise((r) => setTimeout(r, 2));
      env.speech.stop();
    }
    assert.ok(env.ctx.sources.length >= 80);
  } finally {
    env.cleanup();
  }
});

test("extending a rising diphthong-like unit holds the steady tail without amplitude fluctuation", async () => {
  const sampleRate = 48000;
  const bankHz = 364;
  const unitLen = 0.115;
  const gapLen = 0.06;
  const n = Math.round(unitLen * sampleRate);
  const startIdx = Math.round(gapLen * sampleRate);
  const buf = new FakeAudioBuffer(1, Math.round((gapLen * 2 + unitLen) * sampleRate), sampleRate);
  const data = buf.getChannelData(0);

  // Ramp early section (0..55 ms) from 0.15 to 0.85, hold steady 0.85 over 55..85 ms, then fade out 85..115 ms.
  const rampEnd = Math.round(0.055 * sampleRate);
  const fadeStart = Math.round(0.085 * sampleRate);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let env = 0.85;
    if (i < rampEnd) {
      env = 0.15 + 0.70 * (i / rampEnd);
    } else if (i >= fadeStart) {
      const p = (i - fadeStart) / (n - fadeStart);
      env = 0.85 * Math.cos((Math.PI / 2) * p);
    }
    data[startIdx + i] = env * Math.sin(2 * Math.PI * bankHz * t);
  }

  const units = { hao: [gapLen, unitLen] as [number, number] };
  const manifestBytes = Buffer.from(JSON.stringify({ hz: bankHz, units }), "utf8");
  const env = await setupSpeech({ buf, manifestBytes, units, bankHz });
  try {
    env.speech.configure({ unitDurationMs: 360, pitchHz: 400, unitsPerSecond: 13 });
    env.speech.begin("好");
    env.speech.reveal(0);
    await new Promise((r) => setTimeout(r, 10));

    const src = env.ctx.sources[0];
    assert.ok(src?.buffer);
    const pcm = src.buffer.getChannelData(0);
    const tailFrom = Math.round(0.095 * sampleRate);
    const tailTo = pcm.length - Math.round(0.03 * sampleRate);
    const win = Math.round(0.015 * sampleRate);
    const rmsVals: number[] = [];
    for (let p = tailFrom; p + win <= tailTo; p += win) {
      rmsVals.push(measureRms(pcm, p, p + win));
    }
    assert.ok(rmsVals.length >= 6);
    const mean = rmsVals.reduce((a, b) => a + b, 0) / rmsVals.length;
    const modulation = (Math.max(...rmsVals) - Math.min(...rmsVals)) / mean;
    assert.ok(mean > 0.55, `expected steady high-energy tail RMS, got ${mean}`);
    assert.ok(modulation < 0.05, `expected near-flat tail envelope without loop wobble, got ${modulation}`);

    // Target duration in anchor..n (100 ms @ 400 Hz -> ~5274 source samples < 5520) also extends from anchor
    // instead of hitting the source slice's baked-in trailing fade-out.
    env.speech.stop();
    env.speech.configure({ unitDurationMs: 100, pitchHz: 400, unitsPerSecond: 13 });
    env.speech.begin("好");
    env.speech.reveal(0);
    await new Promise((r) => setTimeout(r, 10));

    const midSrc = env.ctx.sources[env.ctx.sources.length - 1];
    assert.ok(midSrc?.buffer);
    const midPcm = midSrc.buffer.getChannelData(0);
    assert.ok(midPcm.length < n);
    const lateRms = measureRms(midPcm, Math.round(midPcm.length * 0.65), Math.round(midPcm.length * 0.78));
    assert.ok(lateRms > 0.55, `expected sustained tail at 100 ms without double fade-out, got ${lateRms}`);
  } finally {
    env.cleanup();
  }
});

test("non-periodic fallback fades out cleanly without repeating the onset", async () => {
  const sampleRate = 48000;
  const bankHz = 364;
  const unitLen = 0.05; // 50 ms short burst with loud impulse at start and unvoiced tail
  const gapLen = 0.06;
  const n = Math.round(unitLen * sampleRate);
  const startIdx = Math.round(gapLen * sampleRate);
  const buf = new FakeAudioBuffer(1, Math.round((gapLen * 2 + unitLen) * sampleRate), sampleRate);
  const data = buf.getChannelData(0);

  let seed = 1337;
  for (let i = 0; i < n; i++) {
    seed = (seed * 16807) % 2147483647;
    const white = (seed / 2147483647) * 2 - 1;
    data[startIdx + i] = i < 400 ? 0.8 * white : 0.1 * white;
  }

  const units = { ci: [gapLen, unitLen] as [number, number] };
  const manifestBytes = Buffer.from(JSON.stringify({ hz: bankHz, units }), "utf8");
  const env = await setupSpeech({ buf, manifestBytes, units, bankHz });
  try {
    env.setUnitsMapper(() => [{ at: 0, key: "ci", tone: 0, weak: false, stress: false, pos: 0, of: 1, end: "" }]);
    env.speech.configure({ unitDurationMs: 250, pitchHz: 400, unitsPerSecond: 13 });
    env.speech.begin("次");
    env.speech.reveal(0);
    await new Promise((r) => setTimeout(r, 10));

    const src = env.ctx.sources[0];
    assert.ok(src?.buffer);
    const pcm = src.buffer.getChannelData(0);
    assert.ok(pcm.length > n);
    // Samples after the original slice length must remain silent instead of re-triggering the onset.
    const repeatTailRms = measureRms(pcm, n + 10, pcm.length);
    assert.equal(repeatTailRms, 0, "non-periodic fallback must not repeat onset burst");
  } finally {
    env.cleanup();
  }
});
