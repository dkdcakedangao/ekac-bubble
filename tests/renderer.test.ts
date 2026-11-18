import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { transformSync } from "esbuild";
import { Segmenter, rmsDb } from "../vendor/segmenter";
import { applySentenceSuffix, normalizeSuffixText } from "../src/sentence-suffix";

const source = readFileSync(new URL("../src/renderer.ts", import.meta.url), "utf8");
// Replace browser imports with boundary fakes; execute the actual renderer handlers.
const code = transformSync(source.replace(/^import .*;\r?\n/gm, ""), {
  loader: "ts",
  format: "cjs",
}).code;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}
async function harness(options: { gate?: string; fail?: string; saveError?: boolean; streaming?: boolean; capture?: string; sound?: boolean; mode?: string; decode?: (pcm: Int16Array) => Promise<string> } = {}) {
  const gate = deferred();
  const entered = deferred();
  let initialized = false;
  async function stage(name: string) {
    if (initialized && options.gate === name) {
      entered.resolve();
      await gate.promise;
    }
    if (initialized && options.fail === name) throw Error(name + " failed");
  }
  const elements = new Map<string, any>();
  function element(id: string) {
    if (!elements.has(id)) elements.set(id, {
      value: "", textContent: "", checked: false, dataset: {}, selectedIndex: 0,
      classList: { toggle() {} }, setAttribute() {}, addEventListener() {},
      replaceChildren() {}, add() {},
    });
    return elements.get(id);
  }
  let worker = false;
  const saves: any[] = [];
  const chats: string[] = [];
  const decoded: string[] = [], played: string[] = [], notices: string[] = [];
  const nodes: AudioWorkletNode[] = [];
  let eventHandler = (_event: any) => {};
  const voice = {
    active: true, idle: false, blocked: true, failNext: false,
    configure() {},
    begin(text: string) {
      played.push(text);
      if (this.failNext) { this.failNext=false; throw Error("playback failed"); }
      this.idle = !this.blocked;
    },
    reveal() {}, stop() { this.idle = true; },
  };
  class AudioWorkletNode {
    port: { onmessage?: (e: any) => void } = {};
    constructor() { nodes.push(this); }
  }
  const tracks: { stopped: boolean; stop(): void; addEventListener(): void }[] = [];
  const contexts: AudioContext[] = [];
  class AudioContext {
    closed = false;
    get state() { return this.closed ? "closed" : "running"; }
    destination = {};
    audioWorklet = { addModule: () => stage("worklet") };
    constructor(public options?: any) { contexts.push(this); }
    createGain() { return { gain: { value: 0 }, connect() {} }; }
    setSinkId() { return stage("sink"); }
    resume() { return stage("resume"); }
    async close() { this.closed = true; }
    createMediaStreamSource() { return { connect() {} }; }
  }
  const settings = {
    mode: options.mode || "general", capture: options.capture || "hold", sound: options.sound ?? !!options.streaming, volume: 0.6,
    pitch: 400, rate: 13, unitDurationMs: 100, hotkey: "F8", mic: "", output: "",
    suffixEnabled: false, suffixText: "喵",
  };
  const sandbox = createContext({
    URLSearchParams, performance, Int16Array, ArrayBuffer,
    setTimeout: options.streaming ? (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 1)) : setTimeout,
    clearTimeout,
    Option: function () {},
    Segmenter, rmsDb,
    applySentenceSuffix, normalizeSuffixText,
    permitUnload() {},
    toast(text: string) { notices.push(text); },
    textSteps: () => 1,
    createSpeech: () => voice,
    AudioContext,
    AudioWorkletNode,
    location: { search: "", hash: "", pathname: "/index.html" },
    history: { replaceState() {} },
    document: { getElementById: element, querySelectorAll: () => [], body: { dataset: {} } },
    window: {
      addEventListener() {},
      scrollTo() {},
      host: {
        events(handler: (e: any) => void) { eventHandler=handler; },
        async call(command: string, data: any) {
          if (command === "init") return { settings, visible: true, modelUrl: "" };
          if (command === "load") worker = true;
          if (command === "unload") worker = false;
          if (command === "chat") chats.push(data);
          if (command === "decode") {
            if (ArrayBuffer.isView(data)) return "临时";
            const pcm = new Int16Array(data);
            const text = String(pcm.find(v=>v!==0));
            decoded.push(text);
            return options.decode ? options.decode(pcm) : text;
          }
          if (command === "save") {
            if (options.saveError) throw Error("save failed");
            saves.push(data);
            return { modelUrl: "" };
          }
          return true;
        },
      },
    },
    navigator: { mediaDevices: {
      addEventListener() {},
      async enumerateDevices() { await stage("devices"); return []; },
      async getUserMedia() {
        await stage("media");
        const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
        tracks.push(track);
        return { getTracks: () => [track] };
      },
    } },
  });
  runInContext(code, sandbox);
  await tick();
  initialized = true;
  return {
    element, tracks, contexts, saves, decoded, played, notices, voice, chats,
    event: (e: any) => eventHandler(e), entered: entered.promise, release: gate.resolve,
    utterance(value: number) {
      const send=(v:number)=>nodes.at(-1)!.port.onmessage!({data:new Int16Array(320).fill(v).buffer});
      for(let i=0;i<20;i++)send(value);
      for(let i=0;i<31;i++)send(0);
    },
    run: (expression: string) => runInContext(expression, sandbox) as any,
    worker: () => worker,
  };
}

for (const boundary of ["devices", "sink", "media", "worklet"]) {
  test("stop cancels microphone startup pending " + boundary, async () => {
    const app = await harness({ gate: boundary });
    const starting = app.run("startMic()");
    await app.entered;
    await app.run("stopMic()");
    if (boundary === "worklet") {
      assert.ok(app.tracks.every((track) => track.stopped));
      assert.ok(app.contexts.filter((ctx) => ctx.options).every((ctx) => ctx.closed));
    }
    app.release();
    await starting;
    assert.equal(app.worker(), false);
    assert.equal(app.run("listening"), false);
    assert.equal(app.run("stream"), null);
    assert.ok(app.tracks.every((track) => track.stopped));
    assert.ok(app.contexts.filter((ctx) => ctx.options).every((ctx) => ctx.closed));
  });
}
for (const boundary of ["sink", "media", "worklet"]) {
  test("failed microphone startup releases resources at " + boundary, async () => {
    const app = await harness({ fail: boundary });
    await assert.rejects(app.run("startMic()"), new RegExp(boundary + " failed"));
    assert.equal(app.worker(), false);
    assert.equal(app.run("listening"), false);
    assert.ok(app.tracks.every((track) => track.stopped));
    assert.ok(app.contexts.every((ctx) => ctx.closed));
  });
}
test("normal microphone start and stop release the committed stream", async () => {
  const app = await harness();
  await app.run("startMic()");
  assert.equal(app.worker(), true);
  assert.equal(app.run("listening"), true);
  assert.equal(app.tracks[0].stopped, false);
  await app.run("stopMic()");
  assert.equal(app.worker(), false);
  assert.equal(app.tracks[0].stopped, true);
});
test("late canceled startup cannot stop a newer microphone session", async () => {
  const app = await harness({ gate: "media" });
  const first = app.run("startMic()");
  await app.entered;
  await app.run("stopMic()");
  const second = app.run("startMic()");
  await tick();
  app.release();
  await Promise.all([first, second]);
  assert.equal(app.worker(), true);
  assert.equal(app.run("listening"), true);
  assert.equal(app.tracks.length, 2);
  assert.equal(app.tracks[0].stopped, true);
  assert.equal(app.tracks[1].stopped, false);
  await app.run("stopMic()");
});
test("closing saves current main controls without pressing save", async () => {
  const app = await harness();
  for (const [id, value] of Object.entries({ volume: "0.37", pitch: "488", rate: "10", "unit-duration": "300", output: "voicemeeter", hotkey: "F9" }))
    app.element(id).value = value;
  await app.run("window.beforeAppClose()");
  assert.equal(app.saves.length, 1);
  assert.equal(app.saves[0].volume, 0.37);
  assert.equal(app.saves[0].pitch, 488);
  assert.equal(app.saves[0].rate, 10);
  assert.equal(app.saves[0].unitDurationMs, 300);
  assert.equal(app.saves[0].output, "voicemeeter");
  assert.equal(app.saves[0].hotkey, "F9");
});
test("failed main save rejects close", async () => {
  const app = await harness({ saveError: true });
  await assert.rejects(app.run("window.beforeAppClose()"), /save failed/);
});

async function until(check:()=>boolean) {
  for(let i=0;i<1000;i++) { if(check())return; await new Promise(r=>setTimeout(r,1)); }
  assert.fail("renderer did not reach expected state");
}
test("continuous PCM capture and final recognition continue while speech is playing", async () => {
  const app=await harness({streaming:true,capture:"continuous"});
  try {
    await app.run("startMic()");
    app.utterance(1000);
    await until(()=>app.played.length===1);
    app.utterance(2000);app.utterance(3000);
    await tick();
    assert.deepEqual(app.decoded,["1000","2000","3000"]);
    assert.equal(app.played.length,1);
    assert.equal(app.run("pending.length"),2);
    assert.equal(app.run("listening"),true);
    app.voice.blocked=false;app.voice.idle=true;
    await until(()=>app.run("active===null"));
    assert.deepEqual(app.played,["1000","2000","3000"]);
  } finally { await app.run("stopMic()"); }
});
test("ten waiting sentences never gate PCM; overflow rejects a whole sentence and recovers", async () => {
  const app=await harness({streaming:true,capture:"continuous"});
  try {
    await app.run("startMic()");app.utterance(1000);
    await until(()=>app.played.length===1);
    for(let i=2;i<=12;i++) {app.utterance(i*1000);await tick();}
    assert.equal(app.decoded.length,12);
    assert.equal(app.run("pending.length"),10);
    assert.ok(app.notices.some(text=>text.includes("队列已满")));
    app.voice.blocked=false;app.voice.idle=true;
    await until(()=>app.run("active===null"));
    assert.deepEqual(app.played,Array.from({length:11},(_,i)=>String((i+1)*1000)));
    app.utterance(13000);await until(()=>app.played.length===12);
    assert.equal(app.played.at(-1),"13000");
  } finally { await app.run("stopMic()"); }
});
test("same recognized sentence plays again, including background capture", async () => {
  const app=await harness({streaming:true,capture:"continuous"});
  try {
    await app.run("startMic()");app.event({type:"visibility",data:false});
    app.utterance(1000);await until(()=>app.played.length===1);
    app.utterance(1000);await tick();
    app.voice.blocked=false;app.voice.idle=true;
    await until(()=>app.run("active===null"));
    assert.deepEqual(app.played,["1000","1000"]);
  } finally { await app.run("stopMic()"); }
});
test("failed playback advances to the next sentence", async () => {
  const app=await harness({streaming:true,capture:"continuous"});
  try {
    await app.run("startMic()");app.voice.failNext=true;app.voice.blocked=false;
    app.utterance(1000);app.utterance(2000);
    await until(()=>app.played.length===2 && app.run("active===null"));
    assert.deepEqual(app.played,["1000","2000"]);
  } finally { await app.run("stopMic()"); }
});
for(const stop of ["stopMic()", "cancel(); resetSegment()"]){
  test("late final recognition is discarded after "+stop,async()=>{
    let resolve!: (text:string)=>void;
    const result=new Promise<string>(done=>resolve=done);
    const app=await harness({streaming:true,capture:"continuous",decode:()=>result});
    try{
      await app.run("startMic()");app.utterance(1000);await tick();
      assert.equal(app.decoded.length,1);
      await app.run(stop);resolve("旧结果");await tick();
      assert.equal(app.run("pending.length"),0);assert.equal(app.played.length,0);
    }finally{resolve("");await app.run("stopMic()");}
  });
}
test("push to talk can queue another utterance during playback",async()=>{
  const app=await harness({streaming:true,capture:"hold"});
  try{
    await app.run("startMic()");app.run("hold(true)");app.utterance(1000);app.run("hold(false)");
    await until(()=>app.played.length===1);
    app.run("hold(true)");app.utterance(2000);app.run("hold(false)");await tick();
    assert.equal(app.run("pending.length"),1);
    assert.deepEqual(app.decoded,["1000","2000"]);
  }finally{await app.run("stopMic()");}
});
test("Chatbox keeps FIFO recognition with sound disabled",async()=>{
  const app=await harness({streaming:true,capture:"continuous",mode:"chatbox",sound:false});
  try{
    await app.run("startMic()");app.utterance(1000);app.utterance(2000);app.utterance(3000);
    await until(()=>app.chats.length===3 && app.run("active===null"));
    assert.deepEqual(app.chats,["1000","2000","3000"]);
    assert.equal(app.run("listening"),true);
  }finally{await app.run("stopMic()");}
});
test("sentence suffix applies to ASR, manual queue, hot-toggles without dropping mic, and persists on close",async()=>{
  const app=await harness({
    streaming:true,
    capture:"continuous",
    mode:"chatbox",
    sound:true,
    decode:async()=>"你好呀！",
  });
  try{
    await app.run("startMic()");
    app.voice.blocked=false;
    // Hot-enable suffix while already listening: must NOT stop mic
    app.element("suffix-enabled").checked=true;
    app.element("suffix-text").value="喵";
    app.element("suffix-enabled").onchange();
    await until(()=>app.saves.length===1);
    assert.equal(app.run("listening"),true);
    assert.equal(app.saves[0].suffixEnabled,true);
    assert.equal(app.saves[0].suffixText,"喵");

    // 1. Microphone recognition receives suffix before exclamation mark
    app.utterance(1000);
    await until(()=>app.chats.length===1 && app.run("active===null"));
    assert.equal(app.chats[0],"你好呀喵！");
    assert.equal(app.played[0],"你好呀喵！");
    assert.equal(app.element("heard").textContent,"最终：你好呀！ → 你好呀喵！");

    // 2. Manual textarea submission also applies suffix + merges redundant period
    app.element("suffix-text").value="喵～";
    app.element("text").value="今天天气真好。";
    app.element("test").onclick();
    await until(()=>app.chats.length===2 && app.run("active===null"));
    assert.equal(app.chats[1],"今天天气真好喵～");
    assert.equal(app.played[1],"今天天气真好喵～");

    // 3. Closing saves updated suffix controls
    app.element("suffix-enabled").checked=false;
    app.element("suffix-text").value="捏";
    await app.run("window.beforeAppClose()");
    assert.equal(app.saves.at(-1).suffixEnabled,false);
    assert.equal(app.saves.at(-1).suffixText,"捏");
  }finally{await app.run("stopMic()");}
});
