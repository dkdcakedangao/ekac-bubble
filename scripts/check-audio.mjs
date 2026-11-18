import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import WebSocket from "ws";
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const dir = resolve("scratch/audio-test-" + Date.now());
mkdirSync(dir, { recursive: true });
writeFileSync(
  dir + "/settings.json",
  JSON.stringify({
    modelDir: "E:/saves/saves/VRC/VRC气泡字幕/models/sense-voice",
    mode: "general",
    hotkey: "F24",
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
  const duration = await send('Runtime.evaluate', {
    expression:`(async()=>{
      const {createSpeech}=await import(new URL('./speech.js',location.href).href);
      const results=[];
      for(const pitch of [200,400,800])for(const ms of [60,160,400]){
        const ctx=new OfflineAudioContext(1,33600,48000),gain=ctx.createGain();gain.connect(ctx.destination);
        const player=createSpeech({output:()=>({ctx,master:gain})},{unitsOf:async()=>[{key:'a',at:0,pos:0,of:1,end:'',tone:0,stress:false}]});
        player.configure({enabled:true,pitchHz:pitch,unitsPerSecond:4,unitDurationMs:ms});
        for(let i=0;!player.active;i++){if(i>400)throw Error('bank timeout');await new Promise(r=>setTimeout(r,10));}
        player.begin('啊');await new Promise(r=>setTimeout(r,0));player.reveal(0);
        const buffer=await ctx.startRendering(),data=buffer.getChannelData(0),fs=ctx.sampleRate;
        const peak=Math.max(...data.map(Math.abs));
        let first=data.findIndex(x=>Math.abs(x)>peak*.01),last=data.length-1;
        while(last>=0&&Math.abs(data[last])<=peak*.01)last--;
        const observed=(last-first+1)/fs*1000;
        const tailStart=Math.floor(first+ms/1000*fs*.65),tailEnd=Math.floor(first+ms/1000*fs*.9);
        let energy=0;for(let i=tailStart;i<tailEnd;i++)energy+=(data[i]||0)**2;
        const tailRms=Math.sqrt(energy/Math.max(1,tailEnd-tailStart));
        const offset=Math.floor(first+ms/1000*fs*.2),size=Math.min(Math.floor(ms/1000*fs*.5),2400);
        let best=-Infinity,lag=0;
        for(let k=Math.floor(fs/(pitch*1.15));k<=Math.ceil(fs/(pitch*.85));k++){
          let cross=0,a=0,b=0;
          for(let i=0;i<size-k;i++){const x=data[offset+i],y=data[offset+i+k];cross+=x*y;a+=x*x;b+=y*y;}
          const score=cross/Math.sqrt(a*b||1);if(score>best){best=score;lag=k;}
        }
        const measuredPitch=fs/lag;
        player.stop();
        if(peak<.001 || Math.abs(observed-ms)>15 || tailRms<.0005 || Math.abs(measuredPitch/pitch-1)>.15)
          throw Error(JSON.stringify({pitch,ms,observed,tailRms,measuredPitch,peak}));
        results.push({pitch,ms,observed:Math.round(observed),tailRms:+tailRms.toFixed(4),measuredPitch:Math.round(measuredPitch)});
      }
      return results;
    })()`,awaitPromise:true,userGesture:true,returnByValue:true,
  });
  if(duration.exceptionDetails || duration.result?.value?.length!==9)throw Error(JSON.stringify(duration));
  console.log('NATIVE_DURATION_PITCH_ENERGY_PASS',JSON.stringify(duration.result.value));
  await send("Runtime.evaluate", {expression:`const frames=new Set();window.__frameStats={max:0,frames};const raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window);window.requestAnimationFrame=cb=>{let id=raf(t=>{frames.delete(id);cb(t)});frames.add(id);window.__frameStats.max=Math.max(window.__frameStats.max,frames.size);return id;};window.cancelAnimationFrame=id=>{frames.delete(id);caf(id);};`});
  const result = await send("Runtime.evaluate", {
    expression: `(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const field=id=>document.getElementById(id);
    field('play-audio').click();await wait(100);const missingSaved=field('audio-status').textContent;field('test-output').value='';field('test-output').dispatchEvent(new Event('change'));
    field('audio-text').value='你好，这是测试。';field('play-audio').click();
    for(let i=0;i<120&&!/播放完成|播放失败/.test(field('audio-status').textContent);i++)await wait(100);
    const first={status:field('audio-status').textContent,text:field('audio-bubble').textContent,peak:Number(field('audio-level').dataset.peakDb)};
    field('test-volume').value='0';field('audio-text').value='静音测试';field('play-audio').click();for(let i=0;i<80&&!/播放完成|播放失败/.test(field('audio-status').textContent);i++)await wait(100);
    const silent=Number(field('audio-level').dataset.peakDb);
    field('test-volume').value='.6';field('audio-text').value='很长的声音测试'.repeat(12);field('play-audio').click();await wait(250);field('stop-audio').click();const stopped=field('audio-status').textContent;await wait(250);const stable=field('audio-status').textContent===stopped;
    for(let i=0;i<6;i++){field('play-audio').click();await wait(70);}field('stop-audio').click();await wait(100);const meterLoops={max:window.__frameStats.max,pending:window.__frameStats.frames.size};
    field('audio-text').value=' ';field('play-audio').click();await wait(50);const empty=field('audio-status').textContent;
    field('test-output').add(new Option('不存在的设备','invalid-device-for-test'));field('test-output').value='invalid-device-for-test';field('audio-text').value='测试';field('play-audio').click();await wait(500);const invalid=field('audio-status').textContent;
    field('test-output').value='';field('audio-text').value='你好，这是音频输出测试。';field('play-audio').click();await wait(500);
    return {first,silent,stopped,stable,empty,invalid,missingSaved,meterLoops};})()`,
    awaitPromise: true,
    userGesture: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw Error(JSON.stringify(result));
  const value = result.result.value;
  if (
    value.missingSaved !== "输出设备不可用，请重新选择后播放" ||
    value.meterLoops.max > 1 || value.meterLoops.pending !== 0 ||
    !value.first.status.startsWith("播放完成") ||
    value.first.text !== "你好，这是测试。" ||
    value.first.peak <= -70 ||
    value.silent > -70 ||
    value.stopped !== "已停止" ||
    !value.stable ||
    value.empty !== "请输入测试文字" ||
    !value.invalid.startsWith("播放失败")
  )
    throw Error(JSON.stringify(value));
  const image = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    "scratch/audio-test-preview.png",
    Buffer.from(image.data, "base64"),
  );
  console.log("AUDIO_TEST_PASS", JSON.stringify(value));
} finally {
  ws?.close();
  child.kill();
}
