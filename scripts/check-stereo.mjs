import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import WebSocket from "ws";
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const dir = resolve("scratch/packaged-data");
mkdirSync(dir, { recursive: true });
writeFileSync(
  dir + "/settings.json",
  JSON.stringify({
    modelDir: "E:/saves/saves/VRC/VRC气泡字幕/models/sense-voice",
    mode: "model",
    sound: true,
    output: "missing-saved-output",
  }),
);
const child = spawn(
  resolve(`release/${version}/win-unpacked/ekac-bubble.exe`),
  ["--remote-debugging-port=9228", "--remote-debugging-address=127.0.0.1"],
  {
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, EKAC_BUBBLE_DATA: dir },
  },
);
let ws;
try {
  let target;
  for (let i = 0; i < 100; i++) {
    try {
      target = (await (await fetch("http://127.0.0.1:9228/json")).json()).find(
        (x) => x.type === "page" && x.url.includes("index.html"),
      );
      if (target) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!target) throw Error("Packaged window not loaded");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.once("open", r));
  let id = 0;
  const pending = new Map();
  ws.on("message", (m) => {
    const d = JSON.parse(String(m));
    if (d.id) {
      pending.get(d.id)?.(d);
      pending.delete(d.id);
    }
  });
  const send = (method, params) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, (d) =>
        d.error ? rej(Error(JSON.stringify(d.error))) : res(d.result),
      );
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => {
        if (pending.has(i)) {
          pending.delete(i);
          rej(Error("CDP timeout " + method));
        }
      }, 20000).unref();
    });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await send("Runtime.evaluate", {
        expression:
          "document.body.dataset.ready==='true'",
        returnByValue: true,
      });
      if (r.result?.value) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw Error("Renderer initialization did not finish");
  await send("Runtime.evaluate", {
    expression: "document.getElementById('audio-test-page').click()",
  });
  let page = false;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await send("Runtime.evaluate", {
        expression: "!!document.getElementById('test-output')?.options.length",
        returnByValue: true,
      });
      if (r.result?.value) {
        page = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw Error("Audio test page did not initialize");
  await send("Runtime.evaluate", {expression:`const frames=new Set();window.__frameStats={max:0,frames};const raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window);window.requestAnimationFrame=cb=>{let id=raf(t=>{frames.delete(id);cb(t)});frames.add(id);window.__frameStats.max=Math.max(window.__frameStats.max,frames.size);return id;};window.cancelAnimationFrame=id=>{frames.delete(id);caf(id);};`});
  const result=await send('Runtime.evaluate',{expression:`(async()=>{const live=new AudioContext();const bytes=await(await fetch('./speech/zh.ogg')).arrayBuffer();const buffer=await live.decodeAudioData(bytes);const bank=await(await fetch('./speech/zh.json')).json();const [off,len]=bank.units.ni;const ctx=new OfflineAudioContext(2,24000,48000),src=ctx.createBufferSource(),gain=ctx.createGain(),analyser=ctx.createAnalyser();src.buffer=buffer;gain.gain.value=.6;src.connect(gain);gain.connect(analyser);analyser.connect(ctx.destination);src.start(0,off,len);const output=await ctx.startRendering();const rms=c=>{const data=output.getChannelData(c);return Math.sqrt(data.reduce((s,x)=>s+x*x,0)/data.length);};const maxDifference=Math.max(...output.getChannelData(0).map((x,i)=>Math.abs(x-output.getChannelData(1)[i])));const info={bankChannels:buffer.numberOfChannels,leftRms:rms(0),rightRms:rms(1),maxDifference,deviceChannels:live.destination.maxChannelCount};await live.close();return info;})()`,awaitPromise:true,returnByValue:true,userGesture:true});
  if(result.exceptionDetails)throw Error(JSON.stringify(result));const value=result.result.value;if(value.leftRms===0||value.maxDifference>1e-6)throw Error(JSON.stringify(value));
  const image = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    "scratch/audio-test-preview.png",
    Buffer.from(image.data, "base64"),
  );
  console.log("STEREO_ROUTING_PASS", JSON.stringify(value));
} finally {
  ws?.close();
  child.kill();
}
