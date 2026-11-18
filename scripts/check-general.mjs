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
    mode: "general",
    sound: true,
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
const fixtureDir = resolve(dir, "models/sensevoice");
mkdirSync(fixtureDir, { recursive: true });
const { copyFileSync } = await import("node:fs");
for (const name of ["model.int8.onnx", "tokens.txt"])
  copyFileSync(
    "E:/saves/saves/VRC/VRC气泡字幕/models/sense-voice/" + name,
    fixtureDir + "/" + name,
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
      }, 45000).unref();
    });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await send("Runtime.evaluate", {
        expression: "document.body.dataset.ready==='true'",
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
  const { readFileSync } = await import("node:fs");
  const wav = readFileSync("E:/saves/saves/VRC/VRC气泡字幕/sample.wav");
  let pos = 12,
    pcm;
  while (pos + 8 < wav.length) {
    const len = wav.readUInt32LE(pos + 4);
    if (wav.toString("ascii", pos, pos + 4) === "data") {
      const b = wav.subarray(pos + 8, pos + 8 + len);
      pcm = Array.from(
        new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)),
      );
      break;
    }
    pos += 8 + len + (len % 2);
  }
  if (!pcm) throw Error("Fixture WAV missing data");
  const result = await send("Runtime.evaluate", {
    expression: `(async()=>{
    await window.host.call('show');await new Promise(r=>setTimeout(r,100));const initial=await window.host.call('runtime-state');
    let denied=0;for(const [command,data] of [['chat','private text'],['model',{type:'begin',text:'private text'}],['clear-chat',null]]){try{await window.host.call(command,data);}catch{denied++;}}
    await window.host.call('load');const loaded=await window.host.call('runtime-state');
    const recognized=await window.host.call('decode',new Int16Array(${JSON.stringify(pcm)}));
    document.getElementById('text').value='你好，通用游戏。';document.getElementById('test').click();await window.host.call('hide');await new Promise(r=>setTimeout(r,2200));const hidden=await window.host.call('runtime-state');await window.host.call('show');await new Promise(r=>setTimeout(r,300));
    const preview=document.getElementById('bubble').textContent;
    await window.host.call('unload');await new Promise(r=>setTimeout(r,500));const stopped=await window.host.call('runtime-state');
    return {initial,loaded,stopped,denied,recognized,preview,hidden: hidden.visible,clearHidden:document.getElementById('clear').hidden};
  })()`,
    awaitPromise: true,
    userGesture: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw Error(JSON.stringify(result));
  const value = result.result.value;
  if (
    value.initial.asrPid !== null ||
    value.initial.modelUrl !== "" ||
    value.initial.mode !== "general" ||
    value.denied !== 3 ||
    value.hidden !== false ||
    !value.loaded.asrPid ||
    value.stopped.asrPid !== null ||
    !value.recognized.includes("开饭时间") ||
    value.preview !== "你好，通用游戏。" ||
    !value.clearHidden
  )
    throw Error(JSON.stringify(value));
  try {
    process.kill(value.loaded.asrPid, 0);
    throw Error("ASR child still alive after unload");
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
  const lifecycle = await send("Runtime.evaluate", {
    expression: `(async()=>{
      const wait=async(test)=>{for(let i=0;i<200;i++){if(await test())return;await new Promise(r=>setTimeout(r,50));}throw Error('lifecycle timeout');};
      const call=window.host.call;
      const media=navigator.mediaDevices;
      const original=media.getUserMedia.bind(media);
      try {
        media.getUserMedia=async()=>{throw Error('fixture microphone denied');};
        document.getElementById('listen').click();
        await wait(async()=>document.getElementById('status').textContent.includes('fixture microphone denied') && !(await call('runtime-state')).asrPid);
        let release;
        let stopped=false;
        media.getUserMedia=()=>new Promise(resolve=>{release=()=>resolve({getTracks:()=>[{stop(){stopped=true;}}]});});
        document.getElementById('listen').click();
        await wait(()=>!!release);
        document.getElementById('listen').click();
        release();
        await wait(async()=>stopped && !(await call('runtime-state')).asrPid);
        return {failedStartReleased:true,canceledTrackStopped:stopped,button:document.getElementById('listen').textContent};
      } finally {media.getUserMedia=original;}
    })()`,
    awaitPromise: true,
    userGesture: true,
    returnByValue: true,
  });
  if (lifecycle.exceptionDetails || lifecycle.result?.value?.button !== '开始监听')
    throw Error(JSON.stringify(lifecycle));
  console.log('MICROPHONE_LIFECYCLE_PASS',JSON.stringify(lifecycle.result.value));
  const duplex = await send('Runtime.evaluate', {
    expression:`(async()=>{
      const wait=async(test)=>{for(let i=0;i<300;i++){if(await test())return;await new Promise(r=>setTimeout(r,50));}throw Error('duplex timeout: '+document.getElementById('status').textContent+' / '+document.getElementById('heard').textContent+' / '+document.getElementById('queue').textContent);};
      const media=navigator.mediaDevices, original=media.getUserMedia.bind(media);
      const fixture=new AudioContext({sampleRate:16000});
      const destination=fixture.createMediaStreamDestination();
      const buffer=fixture.createBuffer(1,${pcm.length},16000);
      buffer.getChannelData(0).set(Float32Array.from(${JSON.stringify(pcm)},x=>x/32768));
      const play=async()=>{const node=fixture.createBufferSource();node.buffer=buffer;node.connect(destination);const ended=new Promise(resolve=>node.onended=resolve);node.start();await ended;};
      const count=()=>Number(document.getElementById('queue').textContent.match(/等待 (\\d+)/)?.[1]||0);
      try{
        media.getUserMedia=async()=>destination.stream;
        const capture=document.getElementById('capture');capture.value='continuous';capture.dispatchEvent(new Event('change'));
        await wait(()=>document.getElementById('status').textContent==='设置已保存');
        document.getElementById('listen').click();await wait(()=>document.getElementById('listen').textContent==='停止监听');
        document.getElementById('text').value='这是用于持续监听验证的长播放句。'.repeat(40);document.getElementById('test').click();
        await wait(()=>document.getElementById('queue').textContent.includes('正在播放'));
        await fixture.resume();await play();await wait(()=>count()>=1);
        const first=count();await play();await wait(()=>count()>first);
        return {firstWaiting:first,secondWaiting:count(),listening:document.getElementById('listen').textContent==='停止监听',stillPlaying:document.getElementById('queue').textContent.includes('正在播放'),recognized:document.getElementById('heard').textContent};
      } finally {
        document.getElementById('listen').click();
        await wait(async()=>!(await window.host.call('runtime-state')).asrPid);
        media.getUserMedia=original;destination.stream.getTracks().forEach(t=>t.stop());await fixture.close();
      }
    })()`,awaitPromise:true,userGesture:true,returnByValue:true,
  });
  if(duplex.exceptionDetails || !duplex.result?.value?.listening || !duplex.result?.value?.stillPlaying)
    throw Error(JSON.stringify(duplex));
  console.log('CONTINUOUS_AUDIO_DUPLEX_PASS',JSON.stringify(duplex.result.value));
  writeFileSync("scratch/resource-report.json",JSON.stringify(value,null,2));
  console.log("GENERAL_MODE_PASS", JSON.stringify(value));
  const image = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("scratch/ui-preview.png", Buffer.from(image.data, "base64"));
  console.log("GENERAL_RENDER_PASS", JSON.stringify(value));
} finally {
  ws?.close();
  child.kill();
}
