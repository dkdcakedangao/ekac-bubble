import "./menu-bar";
import { toast } from "./toast";
import { permitUnload } from "./lifecycle";
import { createSpeech, textSteps } from "../web/speech.js";
const el = (id: string) => document.getElementById(id) as any;
let context: AudioContext | null = null,
  gain: GainNode | null = null,
  analyser: AnalyserNode | null = null,
  player: any;
let generation = 0,
  running = false,
  peakDb = -80;
let configReady = false;
let foreground = true;
let meterFrame: number | null = null;
function stopMeter() {
  if (meterFrame !== null) cancelAnimationFrame(meterFrame);
  meterFrame = null;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function feedback(message: string, kind: "info" | "success" | "error" = "info") {
  el("audio-status").textContent = message;
  toast(message, kind);
}
function stop(message = "已停止") {
  generation++;
  running = false;
  stopMeter();
  player?.stop();
  if (gain) gain.gain.value = 0;
  el("stop-audio").disabled = true;
  el("audio-status").textContent = message;
  el("audio-level").value = -80;
}
async function devices(selected: string = el("test-output").value) {
  const list = await navigator.mediaDevices.enumerateDevices();
  el("test-output").replaceChildren(new Option("系统默认", ""));
  for (const d of list.filter(
    (d) => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default",
  ))
    el("test-output").add(
      new Option(d.label || "音频设备 " + d.deviceId.slice(0, 8), d.deviceId),
    );
  el("test-output").value = selected;
  if (el("test-output").selectedIndex < 0) {
    const missing = new Option("所选设备不可用，请重新选择", selected);
    missing.disabled = true;
    el("test-output").add(missing);
    el("test-output").value = selected;
    stop("输出设备不可用，请重新选择后播放");
  }
}
function meter() {
  meterFrame = null;
  if (!running || !analyser || !foreground) return;
  const values = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(values);
  let energy = 0;
  for (const v of values) energy += v * v;
  const db = Math.max(
    -80,
    20 * Math.log10(Math.max(1e-8, Math.sqrt(energy / values.length))),
  );
  peakDb = Math.max(peakDb, db);
  el("audio-level").value = db;
  el("audio-level").dataset.peakDb = String(peakDb);
  meterFrame = requestAnimationFrame(meter);
}
async function play() {
  stop();
  if (!configReady) {
    feedback("配置尚未载入，请先检查配置文件", "error");
    return;
  }
  if (
    el("test-output").selectedIndex < 0 ||
    el("test-output").selectedOptions[0]?.disabled
  ) {
    feedback("输出设备不可用，请重新选择后播放", "error");
    return;
  }
  const text = el("audio-text").value.trim(),
    volume = Number(el("test-volume").value),
    pitch = Number(el("test-pitch").value),
    rate = Number(el("test-rate").value),
    unitDurationMs = Number(el("test-unit-duration").value);
  if (!text) {
    feedback("请输入测试文字", "error");
    return;
  }
  if (
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 1 ||
    !Number.isFinite(pitch) ||
    pitch < 200 ||
    pitch > 800 ||
    !Number.isFinite(rate) ||
    rate < 4 ||
    rate > 25 ||
    !Number.isFinite(unitDurationMs) ||
    unitDurationMs < 60 ||
    unitDurationMs > 400
  ) {
    feedback("请检查音量、音高、语速和单音节时长范围", "error");
    return;
  }
  const g = generation;
  running = true;
  peakDb = -80;
  el("stop-audio").disabled = false;
  feedback("准备音节库…");
  try {
    if (!context) {
      context = new AudioContext();
      gain = context.createGain();
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      gain.connect(analyser);
      analyser.connect(context.destination);
      player = createSpeech(
        { output: () => ({ ctx: context, master: gain }) },
        { unitsOf: (t: string) => window.host.call("units", t) },
      );
    }
    const sink = el("test-output").value;
    const ctx = context as AudioContext & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (sink && !ctx.setSinkId) throw Error("当前运行环境不支持选择输出设备");
    if (ctx.setSinkId) await ctx.setSinkId(sink);
    if (g !== generation) return;
    gain!.gain.value = volume;
    await context.resume();
    player.configure({ enabled: true, pitchHz: pitch, unitsPerSecond: rate, unitDurationMs });
    const until = performance.now() + 10000;
    while (!player.active) {
      if (g !== generation) return;
      if (performance.now() > until) throw Error("音节库载入超时");
      await sleep(30);
    }
    if (g !== generation) return;
    feedback("播放中 · " + el("test-output").selectedOptions[0].textContent, "success");
    player.begin(text);
    meter();
    let shown = "",
      offset = 0,
      count = 0;
    const total = [...text].length;
    for (const ch of text) {
      if (g !== generation) return;
      shown += ch;
      el("audio-bubble").textContent = shown;
      el("audio-progress").textContent = `${++count} / ${total} 字`;
      player.reveal(offset);
      offset += ch.length;
      await sleep(50 * textSteps(ch));
    }
    while (!player.idle) {
      if (g !== generation) return;
      await sleep(25);
    }
    if (g !== generation) return;
    running = false;
    stopMeter();
    el("stop-audio").disabled = true;
    el("audio-level").value = -80;
    feedback(peakDb > -70
        ? "播放完成"
        : "播放完成（无明显信号，请检查音量或文字读音）", "success");
  } catch (e) {
    if (g === generation) {
      const message = "播放失败：" + (e as Error).message;
      stop(message);
      toast(message, "error");
    }
  }
}
el("play-audio").onclick = () => void play();
el("stop-audio").onclick = () => {
  stop();
  toast("已停止试听", "success");
};
el("refresh-output").onclick = () =>
  void devices().then(() => toast("输出设备已刷新", "success")).catch((e) => {
    stop(String(e));
    toast(String(e), "error");
  });
el("test-output").onchange = () => stop("输出设备已更换，请重新播放");
el("test-volume").oninput = () => {
  if (running && gain) gain.gain.value = Number(el("test-volume").value);
};
for (const id of ["test-pitch", "test-rate", "test-unit-duration"])
  el(id).onchange = () => stop("参数已更换，请重新播放");
window.addEventListener("pagehide", () => {
  stop();
  void context?.close();
});
navigator.mediaDevices.addEventListener(
  "devicechange",
  () => void devices().catch((e) => stop(String(e))),
);
let saveRevision = 0;
async function saveConfig() {
  if (!configReady) return false;
  const revision = ++saveRevision;
  el("config-status").textContent = "等待保存…";
  try {
    await window.host.call("save-audio-test", {
      output: el("test-output").value,
      volume: Number(el("test-volume").value),
      pitch: Number(el("test-pitch").value),
      rate: Number(el("test-rate").value),
      unitDurationMs: Number(el("test-unit-duration").value),
      text: el("audio-text").value,
    });
    if (revision === saveRevision)
      el("config-status").textContent = "已自动保存";
    return true;
  } catch (error) {
    if (revision === saveRevision)
      el("config-status").textContent = "未保存：" + String(error);
    if (revision === saveRevision) toast("测试配置未保存：" + String(error), "error");
    return false;
  }
}
window.beforeAppClose = async () => {
  if (configReady && !(await saveConfig()))
    throw Error("最新测试配置未保存，请修正后重试");
  await window.host.call("flush-audio-config");
};
for (const link of Array.from(
  document.querySelectorAll<HTMLAnchorElement>(".sidebar a"),
)) {
  link.onclick = (event) => {
    event.preventDefault();
    stop();
    void window
      .beforeAppClose()
      .then(() => {
        permitUnload();
        location.href = link.href;
      })
      .catch((error) => {
        el("config-status").textContent = "未保存：" + String(error);
        toast("测试配置未保存：" + String(error), "error");
      });
  };
}
for (const id of ["test-volume", "test-pitch", "test-rate", "test-unit-duration", "audio-text"])
  el(id).addEventListener("input", saveConfig);
el("test-output").addEventListener("change", saveConfig);
el("show-config").onclick = () =>
  void window.host.call("show-audio-config").catch((e) => {
    el("config-status").textContent = String(e);
    toast(String(e), "error");
  });
void (async () => {
  const config = await window.host.call("audio-test-config");
  el("config-path").value = config.path;
  if (config.error) throw Error(config.error);
  const settings = config.settings;
  el("test-volume").value = settings.volume;
  el("test-pitch").value = settings.pitch;
  el("test-rate").value = settings.rate;
  el("test-unit-duration").value = settings.unitDurationMs;
  el("audio-text").value = settings.text;
  await devices(settings.output || "");
  configReady = true;
  el("config-status").textContent = "配置已载入；修改后自动保存";
})().catch((e) => {
  stop("初始化失败：" + String(e));
  el("config-status").textContent = String(e);
  toast("初始化失败：" + String(e), "error");
});

window.host.events((e) => {
  if (e.type === "stop-playback") stop();
  if (e.type === "listen-from-tray") {
    stop();
    void window
      .beforeAppClose()
      .then(() => {
        permitUnload();
        location.href = "./index.html?listen=1";
      })
      .catch((error) => {
        el("audio-status").textContent = String(error);
      });
  }
  if (e.type === "visibility") {
    foreground = !!e.data;
    if (!foreground) stopMeter();
    else if (running && meterFrame === null) meter();
  }
});
