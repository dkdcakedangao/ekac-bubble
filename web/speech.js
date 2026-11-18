/**
 * Coo's speech: while a bubble types, each syllable is read from a voice bank the way Animal Crossing's villagers
 * talk. It stands in for the 'talk' kind's babble and is muted with it. The bank (web/speech/, built by
 * scripts/speech-bank/build.py) holds one pitch-flat unit per toneless Mandarin syllable. Pitch is driven by
 * playbackRate (with phrase/tone curves), while syllable duration is controlled independently via `unitDurationMs`
 * by shortening or extending the final steady sound with a phase-locked single-period tail hold in the source domain.
 *
 * Two clocks: the bubble reveals characters at its own pace (`reveal`), and the voice spaces units by at least
 * `max(1 / unitsPerSecond, unitDuration)`. After each pause mark the voice keeps a silence (VOICE_GAP). Characters
 * revealed before the World answers wait for it.
 *
 * Within a phrase the pitch stays within about a semitone; a stressed syllable is a semitone higher, a Mandarin
 * one follows its tone a little, a question ends rising, an exclamation starts a semitone higher and louder.
 */
const BANK = 'zh';
/** Seconds the voice keeps silent after each pause mark; consecutive marks add up. */
export const VOICE_GAP = {
  ',': .14, '，': .14, '、': .14, ';': .2, '；': .2, ':': .2, '：': .2,
  '.': .45, '。': .45, '!': .5, '！': .5, '?': .5, '？': .5, '…': .3, '~': .1, '～': .1,
};
/** While speech is on, how long the bubble waits after each pause mark, in typing steps (1/20 s). */
export const TEXT_PAUSE = {
  ',': 5, '，': 5, '、': 5, ';': 6, '；': 6, ':': 6, '：': 6,
  '.': 9, '。': 9, '!': 9, '！': 9, '?': 9, '？': 9, '…': 4, '~': 3, '～': 3,
};
/**
 * While speech is on, the typing steps one character takes. A letter of an alphabet (and a space or apostrophe)
 * takes LETTER_STEP: three or four of them make one syllable, where a Han character, kana or Hangul block is one,
 * so letters type faster for the voice to keep its pace, as Animal Crossing's English text does (45-70 letters
 * against 13-14 syllables a second).
 */
const LETTER_STEP = .4;
const ALPHABET = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\s'’-]/u;
export function textSteps(ch) {
  return TEXT_PAUSE[ch] ?? (ALPHABET.test(ch) ? LETTER_STEP : 1);
}
/** Each tone as semitones over the unit, scaled by TONE_AMOUNT; 5 is the neutral tone. */
const TONES = { 1: [.8, .8], 2: [-.6, 1.6], 3: [-1, -1.8, -.6], 4: [1.6, -1.2], 5: [-.8, -.8] };
const TONE_AMOUNT = .35;
const STRESS_ST = 1;
const GAIN = .45;

export const DEFAULT_UNIT_DURATION_MS = 100;
export const MIN_UNIT_DURATION_MS = 60;
export const MAX_UNIT_DURATION_MS = 400;
const ANALYSIS_CACHE_LIMIT = 512;
const BUFFER_CACHE_LIMIT = 64;

/* ---------- the voice clock ---------- */

/** When the voice starts each unit, in seconds on one clock; `now` is when the text revealed it. */
export class VoiceClock {
  constructor() { this.reset(0); }
  reset(now) { this.last = -Infinity; this.end = now; this.free = now; this.gap = 0; }
  /** A pause mark revealed: the next unit starts no sooner than this mark's silence after the voice ends. */
  mark(ch) { this.gap += VOICE_GAP[ch] ?? 0; this.free = this.end + this.gap; }
  /** The start of a unit `len` seconds long, keeping at least `len`, `1 / unitsPerSecond`, and any pause mark gap. */
  place(now, _info, unitsPerSecond, len) {
    const t = Math.max(now, this.last + 1 / unitsPerSecond, this.end, this.free);
    this.last = t;
    this.end = Math.max(this.end, t + len);
    this.free = this.end;
    this.gap = 0;
    return t;
  }
}

/* ---------- source-domain duration synthesis ---------- */

function getBounded(cache, key) {
  if (!cache.has(key)) return undefined;
  const val = cache.get(key);
  cache.delete(key);
  cache.set(key, val);
  return val;
}

function setBounded(cache, key, val, limit) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, val);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

/** Exact integral average of a uniformly spaced setValueCurveAtTime array. */
function curveMeanRate(curve) {
  let sum = 0;
  for (let k = 0; k < curve.length; k++) {
    sum += curve[k] * (k === 0 || k === curve.length - 1 ? 0.5 : 1);
  }
  return sum / (curve.length - 1);
}

/** Catmull-Rom cubic interpolation at fractional sample index `idx` within `arr`. */
function cubicAt(arr, idx) {
  const n = arr.length;
  if (idx <= 0) return arr[0];
  if (idx >= n - 1) return arr[n - 1];
  const i = Math.floor(idx);
  const t = idx - i;
  const p0 = arr[Math.max(0, i - 1)];
  const p1 = arr[i];
  const p2 = arr[Math.min(n - 1, i + 1)];
  const p3 = arr[Math.min(n - 1, i + 2)];
  const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
  const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
  const c = -0.5 * p0 + 0.5 * p2;
  return ((a * t + b) * t + c) * t + p1;
}

function periodMatch(slice, anchor, p) {
  let dot = 0, e1 = 0, e2 = 0, diffSq = 0;
  for (let i = 0; i < p; i++) {
    const a = slice[anchor - p + i];
    const b = slice[anchor + i];
    dot += a * b;
    e1 += a * a;
    e2 += b * b;
    const d = a - b;
    diffSq += d * d;
  }
  const denom = Math.sqrt(e1 * e2);
  if (denom <= 1e-12) return null;
  return { corr: dot / denom, relErr: diffSq / (e1 + e2 + 1e-12) };
}

/**
 * Locates a steady single-period anchor near the end of the voiced core (before the bank's
 * trailing fade-out/pitch droop) so extending the unit holds the final sound without wobble.
 */
function analyzeUnitTail(slice, sampleRate, bankHz) {
  const n = slice.length;
  if (n < 32) return null;

  let peakAbs = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(slice[i]);
    if (a > peakAbs) peakAbs = a;
  }
  if (peakAbs < 1e-6) return null;

  const nomP = Math.max(8, sampleRate / (bankHz || 364));
  const minP = Math.max(8, Math.floor(nomP * 0.88));
  const maxP = Math.min(Math.floor(n / 3), Math.ceil(nomP * 1.12));
  if (maxP < minP) return null;

  const tailGuard = Math.min(Math.floor(n * 0.30), Math.round(0.032 * sampleRate));
  const maxAnchor = n - tailGuard - maxP;
  const minAnchor = Math.max(
    maxP + 2,
    Math.min(maxAnchor, Math.max(Math.round(n * 0.42), maxP + Math.round(0.015 * sampleRate))),
  );
  if (maxAnchor < minAnchor || maxAnchor + maxP > n) return null;

  const win = Math.max(8, Math.round(nomP));
  let peakRms = 0;
  for (let pos = Math.round(n * 0.20); pos + win <= n - tailGuard; pos += Math.max(8, Math.floor(win / 2))) {
    let e = 0;
    for (let i = 0; i < win; i++) e += slice[pos + i] * slice[pos + i];
    const r = Math.sqrt(e / win);
    if (r > peakRms) peakRms = r;
  }
  if (peakRms < 1e-6) return null;

  let bestScore = -Infinity;
  let bestAnchor = Math.floor((minAnchor + maxAnchor) / 2);
  let bestP = Math.round(nomP);
  const step = Math.max(4, Math.floor(nomP / 16));

  for (const rmsGate of [0.70, 0.45, 0.0]) {
    for (let anchor = maxAnchor; anchor >= minAnchor; anchor -= step) {
      let eWin = 0;
      for (let i = 0; i < win; i++) eWin += slice[anchor - win + i] * slice[anchor - win + i];
      const rmsHere = Math.sqrt(eWin / win);
      if (rmsHere < peakRms * rmsGate) continue;

      const posBias = (anchor - minAnchor) / Math.max(1, maxAnchor - minAnchor);
      for (let p = minP; p <= maxP; p++) {
        const m = periodMatch(slice, anchor, p);
        if (!m) continue;
        const score = m.corr - 0.5 * m.relErr + 0.02 * posBias + 0.06 * (rmsHere / peakRms);
        if (score > bestScore) {
          bestScore = score;
          bestAnchor = anchor;
          bestP = p;
        }
      }
    }
    if (bestScore > -Infinity) break;
  }
  if (bestScore === -Infinity) return null;

  // Refine anchor to the sample with lowest period-to-period L2 mismatch.
  let refinedAnchor = bestAnchor;
  let minErr = Infinity;
  const searchSpan = Math.min(16, Math.floor(bestP / 4));
  const loA = Math.max(minAnchor, bestP + 2, bestAnchor - searchSpan);
  const hiA = Math.min(maxAnchor, n - bestP - 2, bestAnchor + searchSpan);
  for (let a = loA; a <= hiA; a++) {
    const m = periodMatch(slice, a, bestP);
    if (m && m.relErr < minErr) {
      minErr = m.relErr;
      refinedAnchor = a;
    }
  }

  // Parabolic sub-sample refinement of the period at `refinedAnchor` (skip boundary lags).
  const corrAt = (p) => (p >= minP && p <= maxP && refinedAnchor - p >= 0 && refinedAnchor + p <= n
    ? periodMatch(slice, refinedAnchor, p)?.corr ?? -1
    : -1);
  const cMid = corrAt(bestP);
  if (cMid < 0.85) return null;

  let pExact = bestP;
  if (bestP > minP && bestP < maxP) {
    const cPrev = corrAt(bestP - 1);
    const cNext = corrAt(bestP + 1);
    const denom = cPrev - 2 * cMid + cNext;
    if (denom < -1e-9 && cMid >= cPrev && cMid >= cNext) {
      const delta = (0.5 * (cPrev - cNext)) / denom;
      if (Math.abs(delta) <= 0.6) pExact = bestP + delta;
    }
  }

  return { anchor: refinedAnchor, pExact };
}

/** Synthesizes a single-unit AudioBuffer of `targetSrcSamples` at `sampleRate` with smooth edges. */
function synthesizeUnitBuffer(ctx, slice, sampleRate, targetSrcSamples, avgRate, analysis) {
  const buf = ctx.createBuffer(1, targetSrcSamples, sampleRate);
  const out = buf.getChannelData(0);
  const n = slice.length;
  if (n === 0) return buf;

  const canExtend = Boolean(analysis) && targetSrcSamples > analysis.anchor;
  let endPos = targetSrcSamples;
  if (!canExtend) {
    const copyLen = Math.min(n, targetSrcSamples);
    out.set(slice.subarray(0, copyLen), 0);
    endPos = copyLen;
  } else {
    const { anchor, pExact } = analysis;
    out.set(slice.subarray(0, anchor), 0);
    for (let pos = anchor; pos < targetSrcSamples; pos++) {
      const k = pos - anchor;
      const u = k - Math.floor(k / pExact) * pExact;
      const w = u / pExact;
      out[pos] = (1 - w) * cubicAt(slice, anchor + u) + w * cubicAt(slice, anchor - pExact + u);
    }
  }

  const targetPhysSec = endPos / (Math.max(1e-3, avgRate) * sampleRate);
  const fadeInSec = Math.min(0.004, targetPhysSec * 0.08);
  const fadeOutSec = Math.min(0.022, targetPhysSec * 0.25);
  const fadeInSamples = Math.min(Math.floor(endPos * 0.2), Math.round(fadeInSec * avgRate * sampleRate));
  const fadeOutSamples = Math.min(Math.floor(endPos * 0.45), Math.max(4, Math.round(fadeOutSec * avgRate * sampleRate)));

  for (let i = 0; i < fadeInSamples; i++) {
    out[i] *= 0.5 * (1 - Math.cos((Math.PI * i) / fadeInSamples));
  }
  const outStart = endPos - fadeOutSamples;
  for (let i = 0; i < fadeOutSamples; i++) {
    out[outStart + i] *= 0.5 * (1 + Math.cos((Math.PI * (i + 1)) / fadeOutSamples));
  }

  return buf;
}

/* ---------- playback ---------- */

/**
 * `sfx` (sound.js) gives the audio output; `onUnit` runs as each unit starts; `base`: where the bank is;
 * `unitsOf(text)`: the units the World gives for `text`.
 */
export function createSpeech(sfx, {
  base = new URL('speech/', import.meta.url).href,
  onUnit = () => {},
  unitsOf = (text) => fetch('/api/speech', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then((d) => d.units),
} = {}) {
  let on = false, hz = 400, ups = 13, unitMs = DEFAULT_UNIT_DURATION_MS;
  /** The bank once fetched: manifest and encoded audio; `buffer` once decoded. */
  let bank = null, fetching = null, decoding = null;
  /** The text being typed, its units by the index that starts them once the World answered, and reveals waiting for that. */
  let text = '', byAt = null, waiting = [], rnd = 1;
  const clock = new VoiceClock();
  const playing = new Set(), timers = new Map();
  const analysisCache = new Map();
  const bufferCache = new Map();
  let cacheCtx = null, cacheBankBuf = null;

  function fetchBank() {
    const origin = typeof location !== 'undefined' ? location.href : import.meta.url;
    const get = (name, how) => fetch(new URL(name, new URL(base, origin))).then((r) => (r.ok ? r[how]() : Promise.reject(new Error(`HTTP ${r.status}`))));
    fetching ??= Promise.all([get(`${BANK}.json`, 'json'), get(`${BANK}.ogg`, 'arrayBuffer')]).then(([manifest, bytes]) => {
      bank = { hz: manifest.hz, units: new Map(Object.entries(manifest.units)), bytes, buffer: null };
    }, (err) => { console.error('说话声没能载入:', err); });
    return fetching;
  }
  /** The output and the decoded bank, or null while speech would not be heard (then the caller babbles). */
  function ready() {
    if (!on) return null;
    if (!bank) { void fetchBank(); return null; }
    const out = sfx.output('talk');
    if (!out) return null;
    if (!bank.buffer) {
      decoding ??= out.ctx.decodeAudioData(bank.bytes.slice(0)).then((b) => { bank.buffer = b; }, (err) => console.error('说话声没能解码:', err));
      return null;
    }
    return out;
  }
  const random = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };

  function getUnitSlice(key, off, len) {
    const channel = bank.buffer.getChannelData(0);
    const sr = bank.buffer.sampleRate;
    const s0 = Math.max(0, Math.min(channel.length, Math.round(off * sr)));
    const s1 = Math.max(s0, Math.min(channel.length, Math.round((off + len) * sr)));
    return channel.subarray(s0, s1);
  }

  function getSynthesizedBuffer(ctx, key, off, len, targetSrcSamples, avgRate) {
    if (cacheBankBuf !== bank.buffer) {
      analysisCache.clear();
      bufferCache.clear();
      cacheBankBuf = bank.buffer;
    }
    if (cacheCtx !== ctx) {
      bufferCache.clear();
      cacheCtx = ctx;
    }
    const bufKey = `${key}:${targetSrcSamples}`;
    let buf = getBounded(bufferCache, bufKey);
    if (buf) return buf;

    const sr = bank.buffer.sampleRate;
    const slice = getUnitSlice(key, off, len);
    let analysis = getBounded(analysisCache, key);
    if (analysis === undefined) {
      analysis = analyzeUnitTail(slice, sr, bank.hz);
      setBounded(analysisCache, key, analysis, ANALYSIS_CACHE_LIMIT);
    }
    buf = synthesizeUnitBuffer(ctx, slice, sr, targetSrcSamples, avgRate, analysis);
    setBounded(bufferCache, bufKey, buf, BUFFER_CACHE_LIMIT);
    return buf;
  }

  function play(out, u, t, targetSec) {
    const [off, len] = bank.units.get(u.key);
    const { ctx, master } = out;
    const rate = hz / bank.hz;
    // the phrase's line: a step up at its start, a slow fall, a rise at a question's end
    const q = /[?？]/.test(u.end), ex = /[!！]/.test(u.end), last = u.pos === u.of - 1;
    let st = (u.pos === 0 ? .8 : 0) - .06 * u.pos + (random() - .5) * .4 + (ex ? 1 : 0) + (u.stress ? STRESS_ST : 0);
    let bend = 0;
    if (q && u.pos === u.of - 2) st += 1.5;
    if (q && last) { st += 2; bend = 3; }
    if (/…/.test(u.end) && last) st -= .8;
    const tone = u.tone ? TONES[u.tone] : [0, 0];
    const curve = new Float32Array(8);
    for (let k = 0; k < 8; k++) {
      const p = k / 7, x = p * (tone.length - 1), a = Math.floor(x), b = Math.min(tone.length - 1, a + 1);
      const ts = (tone[a] + (tone[b] - tone[a]) * (x - a)) * TONE_AMOUNT;
      curve[k] = rate * 2 ** ((st + ts + bend * p) / 12);
    }
    const avgRate = curveMeanRate(curve);
    const sr = bank.buffer.sampleRate;
    const targetSrcSamples = Math.max(16, Math.round(targetSec * avgRate * sr));
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = getSynthesizedBuffer(ctx, u.key, off, len, targetSrcSamples, avgRate);
    src.playbackRate.setValueCurveAtTime(curve, t, targetSec);
    g.gain.value = GAIN * (ex ? 1.26 : 1);
    src.connect(g); g.connect(master);
    src.start(t);
    src.stop(t + targetSec);
    playing.add(src);
    src.onended = () => playing.delete(src);
    const timer = setTimeout(() => { timers.delete(timer); onUnit(); }, Math.max(0, (t - ctx.currentTime) * 1000));
    timers.set(timer, t);
  }

  let asked = false;
  /** Asks the World for the units of the text being typed; the reveals waiting meanwhile are spoken once they come. */
  function ask() {
    if (asked || !text) return;
    asked = true;
    const t = text;
    unitsOf(t).then((units) => {
      if (text !== t) return;
      byAt = new Map();
      for (const u of units) { if (!byAt.has(u.at)) byAt.set(u.at, []); byAt.get(u.at).push(u); }
      const out = ready();
      if (out) for (const i of waiting) speak(out, i);
      waiting = [];
    }, (err) => { console.error('说话声没能拆成音节:', err); if (text === t) { byAt = new Map(); waiting = []; } });
  }

  /** Character `i` reaches the voice: its pause mark, then the units it starts. */
  function speak(out, i) {
    const ch = text[i];
    if (VOICE_GAP[ch] !== undefined) clock.mark(ch);
    const now = out.ctx.currentTime + .02;
    if (clock.end < now - 2) clock.reset(now);
    const unitSec = unitMs / 1000;
    for (const u of byAt.get(i) ?? []) {
      const entry = bank.units.get(u.key);
      if (!entry || entry[1] <= 0) continue;
      const t = clock.place(now, { weak: u.weak, final: u.pos >= u.of - 2 }, ups, unitSec);
      if (t !== null) play(out, u, t, unitSec);
    }
  }

  return {
    /** `enabled`; `pitchHz`: the voice's pitch; `unitsPerSecond`: max start rate; `unitDurationMs`: target syllable duration (60..400 ms). */
    configure({ enabled, pitchHz, unitsPerSecond, unitDurationMs } = {}) {
      if (typeof enabled === 'boolean') { on = enabled; if (on) void fetchBank(); else this.stop(); }
      if (typeof pitchHz === 'number' && pitchHz > 0) hz = pitchHz;
      if (typeof unitsPerSecond === 'number' && unitsPerSecond > 0) ups = unitsPerSecond;
      if (typeof unitDurationMs === 'number' && Number.isFinite(unitDurationMs)) {
        unitMs = Math.min(MAX_UNIT_DURATION_MS, Math.max(MIN_UNIT_DURATION_MS, unitDurationMs));
      }
    },
    /** Whether the bubble types with speech's pauses and leaves the sound to it. */
    get active() { return Boolean(ready()); },
    /** The bubble starts typing `t`: while speech is on, its units are asked for now, else at its first reveal. */
    begin(t) {
      if (t === text) return;
      text = t; byAt = null; waiting = []; asked = false;
      if (on) ask();
    },
    /** Character `i` of the text just appeared; false = speech cannot play now, babble instead. */
    reveal(i) {
      const out = ready();
      if (!out) return false;
      if (byAt) speak(out, i); else { waiting.push(i); ask(); }
      return true;
    },
    get idle() {
      const out = sfx.output('talk');
      const now = out?.ctx.currentTime;
      const pendingTimers = out
        ? Array.from(timers.values()).some((t) => t > now)
        : timers.size > 0;
      return (!text || (asked && byAt !== null))
        && waiting.length === 0
        && playing.size === 0
        && !pendingTimers
        && (!bank?.buffer || !out || now >= Math.max(clock.end, clock.free));
    },
    /** Stops what is playing and what waits to play. */
    stop() {
      for (const s of playing) { try { s.stop(); } catch { /* not started */ } }
      playing.clear();
      for (const t of timers.keys()) clearTimeout(t);
      timers.clear();
      clock.reset(0);
      text = ''; byAt = null; waiting = []; asked = false;
    },
  };
}
