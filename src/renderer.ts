import "./menu-bar";
import { toast } from "./toast";
import { permitUnload } from "./lifecycle";
import { Segmenter, rmsDb } from "../vendor/segmenter";
import { createSpeech, textSteps } from "../web/speech.js";
import { applySentenceSuffix, normalizeSuffixText } from "./sentence-suffix";
declare global {
  interface Window {
    beforeAppClose: () => Promise<void>;
    host: {
      call: (cmd: string, data?: any) => Promise<any>;
      events: (fn: (e: any) => void) => void;
    };
  }
}
const $ = (id: string) => document.getElementById(id) as any;
const startFromTray =
  new URLSearchParams(location.search).get("listen") === "1";
const call = window.host.call;
window.beforeAppClose = async () => {
  if (settings) await save(true);
  else await stopMic();
  await call("flush-audio-config");
};
let settings: any;
let devicesLoaded = false;
let foreground = true;
let lastHeard = "尚未识别",
  lastBubble = "你的话，会在这里慢慢出现。";
let generation = 0,
  stream: MediaStream | null = null,
  micContext: AudioContext | null = null,
  holding = false,
  listening = false,
  partialBusy = false;
let micRevision = 0;
let startingMic = false;
let audio: any, speech: any;
let active: string | null = null;
const pending: string[] = [];
const MAX_PENDING = 10;
let sequence = 0;
let socket: WebSocket | null = null;
function status(message: string) {
  $("status").textContent = message;
  const lines = (
    $("events").textContent +
    "\n" +
    new Date().toLocaleTimeString() +
    " " +
    message
  ).split("\n");
  $("events").textContent = lines.slice(-8).join("\n");
}
async function safe(fn: () => any) {
  try {
    return await fn();
  } catch (e) {
    status((e as Error).message);
    toast((e as Error).message, "error");
    return null;
  }
}
function read() {
  return {
    ...settings,
    mode: $("mode").value,
    capture: $("capture").value,
    sound: $("sound").checked,
    volume: Number($("volume").value),
    pitch: Number($("pitch").value),
    rate: Number($("rate").value),
    unitDurationMs: Number($("unit-duration").value),
    hotkey: $("hotkey").value,
    mic: $("mic").value,
    output: $("output").value,
    suffixEnabled: Boolean($("suffix-enabled").checked),
    suffixText: normalizeSuffixText($("suffix-text").value),
    customGlyphs: String($("custom-glyphs").value ?? "").replace(/[\x00-\x1f\x7f]/g, ""),
  };
}
function updateCustomGlyphInfo(reply?: any) {
  const el = $("custom-glyphs-info");
  if (!el) return;
  const raw = String($("custom-glyphs").value ?? "").trim();
  if (typeof reply?.customAssignedCount === "number") {
    const cap = reply.customCapacity ?? 64;
    const overflow =
      typeof reply.customOverflowCount === "number" && reply.customOverflowCount > 0
        ? `；超出上限 ${cap} 格，多余 ${reply.customOverflowCount} 字未映射`
        : "";
    el.textContent =
      reply.customAssignedCount > 0
        ? `已映射到第 128 行扩展槽位：${reply.customAssignedCount} / ${cap} 格（需与 Unity 字库工坊同步烘焙${overflow}）`
        : raw
          ? "所填字符均已在默认 8,089 字库中内置，无需占用额外槽位"
          : "当前未设置额外生僻字（默认 8,089 字库 + 繁简转换已生效）";
  } else {
    el.textContent = raw
      ? "输入变更将在失去焦点或保存时生效（第 128 行最多 64 格）"
      : "当前未设置额外生僻字（默认 8,089 字库 + 繁简转换已生效）";
  }
}
function updateSuffixPreview() {
  const enabled = Boolean($("suffix-enabled").checked);
  const suf = normalizeSuffixText($("suffix-text").value).trim();
  if (!enabled) {
    $("suffix-preview").textContent = suf
      ? `未开启 · 开启后每句末尾自动追加「${suf}」`
      : "未开启 · 开启后在每句末尾自动追加设定文字";
    return;
  }
  if (!suf) {
    $("suffix-preview").textContent = "已开启，但尚未填写句尾文字";
    return;
  }
  const sample = applySentenceSuffix("你好呀！", true, suf);
  $("suffix-preview").textContent = `预览：「你好呀！」→「${sample}」`;
}
function protocol(event: any) {
  if (settings.mode === "model")
    void call("model", event).catch((e) => status(String(e)));
}
function queueStatus() {
  $("queue").textContent =
    `${active ? "正在播放 · " : ""}等待 ${pending.length} / ${MAX_PENDING}${pending.length >= MAX_PENDING ? " · 队列满，继续监听" : ""}`;
}
function cancel() {
  generation++;
  pending.length = 0;
  if (active) protocol({ type: "cancel", id: active });
  void call("cancel", active).catch((e) => status(String(e)));
  active = null;
  speech?.stop();
  queueStatus();
  $("bubble").textContent = "已停止";
}
function enqueue(text: string) {
  text = applySentenceSuffix(
    text,
    Boolean(settings?.suffixEnabled),
    String(settings?.suffixText ?? ""),
  );
  if (!text) return false;
  if (pending.length >= MAX_PENDING) {
    status("播放队列已满，本句已丢弃，继续监听");
    toast("播放队列已满，本句已丢弃，继续监听", "error");
    return false;
  }
  pending.push(text);
  queueStatus();
  void playNext();
  return true;
}
async function output(current = () => true) {
  if (!audio) {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    audio = { ctx, master: gain };
    speech = createSpeech(
      { output: () => audio },
      { unitsOf: (text: string) => call("units", text) },
    );
  }
  const target = audio, player = speech;
  target.master.gain.value = settings.volume;
  if (settings.output) {
    if (!("setSinkId" in target.ctx))
      throw Error("当前音频运行时不支持设备选择");
    await target.ctx.setSinkId(settings.output);
  } else if ("setSinkId" in target.ctx) await target.ctx.setSinkId("");
  if (!current()) return;
  await target.ctx.resume();
  if (!current()) return;
  player.configure({
    enabled: settings.sound,
    pitchHz: settings.pitch,
    unitsPerSecond: settings.rate,
    unitDurationMs: settings.unitDurationMs,
  });
  if (settings.sound) {
    const until = performance.now() + 10000;
    while (!player.active) {
      if (!current()) return;
      if (performance.now() > until) throw Error("音节库加载超时");
      await new Promise((r) => setTimeout(r, 30));
    }
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function playNext() {
  if (active || !pending.length) return;
  const id = String(++sequence);
  active = id;
  const g = generation,
    text = pending.shift()!;
  queueStatus();
  try {
    await output(() => g === generation);
    if (g !== generation) return;
    const vrcChunks =
      settings.mode === "model"
        ? ((await call("model-layout", text)) as Array<{
            startCp: number;
            endCp: number;
            len: number;
            line1Len: number;
            glyphs: Array<{ col: number; row: number; advance: number }>;
          }>)
        : [];
    if (g !== generation) return;
    const start = performance.now();
    protocol({
      type: "begin",
      id,
      text,
      pitchHz: settings.pitch,
      unitsPerSecond: settings.rate,
      unitDurationMs: settings.unitDurationMs,
      sound: settings.sound,
    });
    let nextVrcIdx = 0;
    if (settings.mode === "model" && vrcChunks.length > 0) {
      void call("model-chunk", vrcChunks[0]).catch((e) => status(String(e)));
      nextVrcIdx = 1;
    }
    if (settings.mode === "chatbox")
      void call("chat", text).catch((e) => status(String(e)));
    speech.begin(text);
    let shown = "",
      offset = 0,
      cpIndex = 0;
    for (const ch of text) {
      if (g !== generation) return;
      if (
        settings.mode === "model" &&
        nextVrcIdx < vrcChunks.length &&
        cpIndex >= vrcChunks[nextVrcIdx].startCp
      ) {
        void call("model-chunk", vrcChunks[nextVrcIdx]).catch((e) =>
          status(String(e)),
        );
        nextVrcIdx++;
      }
      shown += ch;
      lastBubble = shown;
      if (foreground) $("bubble").textContent = shown;
      if (settings.sound) speech.reveal(offset);
      offset += ch.length;
      cpIndex++;
      protocol({
        type: "reveal",
        id,
        count: [...shown].length,
        elapsedMs: Math.round(performance.now() - start),
      });
      await sleep(50 * textSteps(ch));
    }
    // Wait for the actual voice clock and audio nodes, not a guessed sentence length.
    while (settings.sound && !speech.idle) {
      if (g !== generation) return;
      await sleep(25);
    }
    if (g === generation) {
      protocol({ type: "end", id });
      await sleep(800);
    }
  } catch (e) {
    if (g !== generation) return;
    status("播放失败：" + (e as Error).message);
    toast("播放失败：" + (e as Error).message, "error");
    protocol({ type: "cancel", id });
    speech?.stop();
  } finally {
    if (g === generation) {
      active = null;
      queueStatus();
      void playNext();
    }
  }
}
const cfg = {
  thresholdDb: -42,
  minSpeechMs: 180,
  dispatchSilenceMs: 600,
  silenceMs: 600,
  maxUtteranceMs: 15000,
  preRollMs: 320,
  minUtteranceMs: 350,
};
let segment: Segmenter;
let sentenceFrames: Int16Array[] = [];
let samples = 0,
  decodedAt = 0;
function joined() {
  const all = new Int16Array(samples);
  let i = 0;
  for (const f of sentenceFrames) {
    all.set(f, i);
    i += f.length;
  }
  return all;
}
function resetSegment() {
  sentenceFrames = [];
  samples = 0;
  decodedAt = 0;
  segment = new Segmenter(
    settings?.capture === "hold"
      ? { ...cfg, thresholdDb: -65, minSpeechMs: 20, minUtteranceMs: 100 }
      : cfg,
    20,
  );
  segment.setSink({
    begin: (frames) => {
      sentenceFrames = frames.slice();
      samples = frames.reduce((s, f) => s + f.length, 0);
      decodedAt = 0;
    },
    frame: (f) => {
      sentenceFrames.push(f);
      samples += f.length;
      if (foreground && !partialBusy && samples - decodedAt >= 8000) {
        decodedAt = samples;
        partialBusy = true;
        const g = generation;
        void call("decode", joined())
          .then((t) => {
            if (g === generation && foreground) {
              lastHeard = "识别中：" + t;
              $("heard").textContent = lastHeard;
            }
          })
          .catch((e) => {
            if (g === generation) status(String(e));
          })
          .finally(() => (partialBusy = false));
      }
    },
    end: (kept) => {
      if (!kept) return;
      const pcm = joined(),
        g = generation;
      const result = call("decode", pcm.buffer)
        .then((text) => {
          if (g === generation) {
            const finalPreview = applySentenceSuffix(
              text,
              Boolean(settings?.suffixEnabled),
              String(settings?.suffixText ?? ""),
            );
            lastHeard =
              finalPreview && finalPreview !== text.trim()
                ? `最终：${text} → ${finalPreview}`
                : "最终：" + text;
            if (foreground) $("heard").textContent = lastHeard;
            enqueue(text);
          }
          return { text, ms: 0, error: null };
        })
        .catch((e) => {
          if (g === generation) status(String(e));
          return { text: "", ms: 0, error: String(e) };
        });
      return result;
    },
  });
}
async function stopMic() {
  micRevision++;
  startingMic = false;
  cancel();
  listening = false;
  holding = false;
  const stoppedStream = stream, stoppedContext = micContext;
  stream = null;
  micContext = null;
  stoppedStream?.getTracks().forEach((t) => t.stop());
  resetSegment();
  $("listen").textContent = "开始监听";
  await Promise.all([
    call("unload"),
    call("listening", false),
    stoppedContext?.close(),
  ]);
}
async function startMic() {
  const stopping = stopMic();
  const revision = micRevision;
  const current = () => revision === micRevision;
  let acquiredStream: MediaStream | null = null;
  let acquiredContext: AudioContext | null = null;
  startingMic = true;
  $("listen").textContent = "取消启动";
  try {
    await stopping;
    if (!current()) return;
    await call("load");
    if (!current()) return;
    await devices();
    if (!current()) return;
    await output(current);
    if (!current()) return;
    acquiredStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        ...(settings.mic ? { deviceId: { exact: settings.mic } } : {}),
      },
    });
    if (!current()) return;
    acquiredContext = new AudioContext({ sampleRate: 16000 });
    // Expose acquired handles so stop can release them while the worklet loads.
    stream = acquiredStream;
    micContext = acquiredContext;
    await acquiredContext.audioWorklet.addModule("./mic-worklet.js");
    if (!current()) return;
    const node = new AudioWorkletNode(acquiredContext, "pet-mic");
    acquiredContext.createMediaStreamSource(acquiredStream).connect(node);
    node.port.onmessage = (e) => {
      if (!current() || !listening) return;
      const f = new Int16Array(e.data);
      if (foreground) $("level").value = rmsDb(f);
      if (settings.capture === "hold" && !holding) return;
      segment.push(f);
    };
    for (const t of acquiredStream.getTracks())
      t.addEventListener("ended", () => {
        if (!current()) return;
        status("麦克风已断开");
        void safe(stopMic);
      });
    acquiredStream = acquiredContext = null;
    listening = true;
    await call("listening", true);
    if (current()) $("listen").textContent = "停止监听";
  } catch (error) {
    if (!current()) return;
    const failedAudio = audio;
    const stopped = stopMic();
    audio = speech = null;
    await Promise.all([stopped, failedAudio?.ctx.close()]);
    throw error;
  } finally {
    acquiredStream?.getTracks().forEach((t) => t.stop());
    if (acquiredContext && acquiredContext.state !== "closed")
      await acquiredContext.close();
    if (current()) startingMic = false;
  }
}
function hold(on: boolean) {
  if (!listening || settings.capture !== "hold") return;
  if (on && !holding) resetSegment();
  if (!on && holding) segment.flush();
  holding = on;
}
async function devices() {
  if (!devicesLoaded) {
    devicesLoaded = true;
    navigator.mediaDevices.addEventListener(
      "devicechange",
      () => void safe(devices),
    );
  }
  const ds = await navigator.mediaDevices.enumerateDevices();
  for (const [id, kind] of [
    ["mic", "audioinput"],
    ["output", "audiooutput"],
  ]) {
    const saved = settings?.[id] ?? "";
    $(id).replaceChildren(new Option("系统默认", ""));
    for (const d of ds.filter(
      (d) => d.kind === kind && d.deviceId && d.deviceId !== "default",
    ))
      $(id).add(new Option(d.label || d.deviceId, d.deviceId));
    $(id).value = saved;
    if ($(id).selectedIndex < 0) {
      const missing = new Option("所选设备不可用，请重新选择", saved);
      missing.disabled = true;
      $(id).add(missing);
      $(id).value = saved;
    }
  }
}
async function save(restart = false) {
  const next = read();
  if (restart) await stopMic();
  else cancel();
  const reply = await call("save", next);
  settings = next;
  $("endpoint").value = reply.modelUrl;
  updateCustomGlyphInfo(reply);
  updateMode();
  status("设置已保存");
  toast("设置已保存", "success");
}
$("save").onclick = () => safe(async () => {
  toast("正在保存设置…");
  await save(true);
});
$("listen").onclick = () =>
  safe(async () => {
    if (listening || startingMic) {
      const wasStarting = startingMic;
      await stopMic();
      toast(wasStarting ? "已取消启动监听" : "已停止监听", "success");
    } else {
      toast("正在启动监听，请稍候…");
      await startMic();
      if (listening) toast("已开始监听，可以说话了", "success");
    }
  });
$("hold").onpointerdown = () => hold(true);
for (const event of ["pointerup", "pointercancel", "pointerleave"])
  $("hold").addEventListener(event, () => hold(false));
for (const id of ["mode", "capture", "mic"])
  $(id).onchange = () => safe(() => save(true));
$("test").onclick = () =>
  safe(async () => {
    const next = read();
    const reply = await call("save", next);
    settings = next;
    $("endpoint").value = reply.modelUrl;
    updateCustomGlyphInfo(reply);
    updateMode();
    if (enqueue($("text").value)) toast("文字已提交到播放队列", "success");
    else if (!$("text").value.trim()) toast("请输入要播放的文字", "error");
  });
$("stop").onclick = () => {
  cancel();
  resetSegment();
  toast("已停止播放并清空队列", "success");
};
$("clear").onclick = () => safe(async () => {
  if (settings.mode === "model") {
    await call("clear-model");
    toast("已发送模型气泡清空请求", "success");
  } else {
    await call("clear-chat");
    toast("已发送 Chatbox 清空请求", "success");
  }
});
$("devices").onclick = () => safe(async () => {
  await devices();
  toast("音频设备已刷新", "success");
});
for (const id of ["download", "load"]) $(id).onclick = () => safe(async () => {
  toast(id === "download" ? "正在下载并加载识别模型…" : "正在加载识别模型…");
  await call(id);
  toast("识别模型已就绪", "success");
});
$("folder").onclick = () =>
  safe(async () => {
    const dir = await call("choose-model");
    if (!dir) return;
    $("modeldir").textContent = dir;
    toast("识别模型已导入", "success");
  });
$("connect").onclick = () => {
  socket?.close();
  socket = new WebSocket($("endpoint").value);
  let remote: any;
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "snapshot") remote = msg.state;
    else if (msg.type === "begin") remote = { ...msg, count: 0 };
    else if (msg.type === "reveal" && remote?.id === msg.id)
      remote.count = msg.count;
    else if (msg.type === "cancel" && remote?.id === msg.id) remote = null;
    $("remote").textContent = remote
      ? [...remote.text].slice(0, remote.count).join("")
      : "等待下一句";
  };
  socket.onopen = () => toast("模型测试器已连接", "success");
  socket.onerror = () => {
    status("模型协议端口连接失败");
    toast("模型协议端口连接失败", "error");
  };
};
window.host.events((e) => {
  if (e.type === "status") status(e.data);
  if (e.type === "hold") hold(e.data);
  if (e.type === "toggle-listen") {
    if (document.querySelector("#listen")) $("listen").click();
  }
  if (e.type === "stop-playback") {
    cancel();
    resetSegment();
  }
  if (e.type === "visibility") {
    foreground = !!e.data;
    if (foreground) {
      $("bubble").textContent = lastBubble;
      $("heard").textContent = lastHeard;
    }
  }
});
void safe(async () => {
  const init = await call("init");
  settings = init.settings;
  foreground = init.visible;
  for (const k of ["mode", "capture", "pitch", "rate", "volume", "hotkey"])
    $(k).value = settings[k];
  $("unit-duration").value = settings.unitDurationMs;
  $("sound").checked = settings.sound;
  $("suffix-enabled").checked = Boolean(settings.suffixEnabled);
  $("suffix-text").value = settings.suffixText ?? "喵";
  $("custom-glyphs").value = settings.customGlyphs ?? "";
  updateSuffixPreview();
  updateCustomGlyphInfo(init);
  $("endpoint").value = init.modelUrl;
  resetSegment();
  updateMode();
  for (const id of ["mic", "output"]) {
    const saved = settings[id];
    if (saved) {
      $(id).add(new Option("上次选择（刷新设备可查看名称）", saved));
      $(id).value = saved;
    }
  }
  await safe(devices);
  document.body.dataset.ready = "true";
  if (init.outputError) status(init.outputError);
  if (startFromTray) await startMic();
});

$("audio-test-page").onclick = () =>
  safe(async () => {
    await window.beforeAppClose();
    permitUnload();
    location.href = "./audio-test.html";
  });

function showPanel(panel: "workspace" | "model" | "tutorial") {
  for (const name of ["workspace", "model", "tutorial"]) {
    const selected = name === panel;
    $(name + "-panel").hidden = !selected;
    $(name + "-nav").classList.toggle("active", selected);
    $(name + "-nav").setAttribute("aria-current", selected ? "page" : "false");
  }
  const pages = {
    workspace: ["语音工作台", "从一句话开始，让声音和文字一起出现。"],
    model: ["模型端口", "连接本机适配器，预览文字与播放进度。"],
    tutorial: ["教程", "从第一次试听，到游戏里开口。"],
  };
  $("page-title").textContent = pages[panel][0];
  $("page-description").textContent = pages[panel][1];
  history.replaceState(null, "", location.pathname + (panel === "workspace" ? "" : "#" + panel));
  window.scrollTo(0, 0);
}
$("workspace-nav").onclick = () => showPanel("workspace");
$("model-nav").onclick = () => showPanel("model");
$("tutorial-nav").onclick = () => showPanel("tutorial");
function panelFromHash() {
  showPanel(location.hash === "#tutorial" ? "tutorial" : location.hash === "#model" ? "model" : "workspace");
}
panelFromHash();
window.addEventListener("hashchange", panelFromHash);
for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-official-link]"))) {
  link.onclick = (event) => {
    event.preventDefault();
    void safe(() => call("open-official", link.dataset.officialLink));
  };
}

function updateMode() {
  $("clear").hidden = settings.mode === "general";
  $("clear").textContent =
    settings.mode === "model" ? "清除模型气泡" : "清除 Chatbox";
  $("mode-note").textContent =
    settings.mode === "general"
      ? settings.sound
        ? "仅输出到所选音频设备，不发送 Chatbox 或模型消息。"
        : "语音已关闭，当前不会向游戏输出内容。"
      : settings.mode === "chatbox"
        ? "整句发送到 VRChat Chatbox，音节声音单独播放。"
        : "不发 Chatbox，通过 VRChat Avatar OSC (9000) 推送头顶模型气泡，同时保留本机协议端口。";
  $("connect").disabled = settings.mode !== "model" || !$("endpoint").value;
  if (settings.mode !== "model") {
    socket?.close();
    socket = null;
    $("remote").textContent = "切换到模型气泡模式后可连接";
  }
}
$("hide-app").onclick = () => void call("hide");
$("sound").onchange = () => void safe(() => save(false));
async function saveQuiet() {
  updateSuffixPreview();
  const next = read();
  const reply = await call("save", next);
  settings = next;
  $("endpoint").value = reply.modelUrl;
  updateCustomGlyphInfo(reply);
  updateMode();
}
$("suffix-enabled").onchange = () => void safe(saveQuiet);
$("suffix-text").oninput = () => updateSuffixPreview();
$("suffix-text").onchange = () => void safe(saveQuiet);
$("custom-glyphs").oninput = () => updateCustomGlyphInfo();
$("custom-glyphs").onchange = () => void safe(saveQuiet);
