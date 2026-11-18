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
const fixtureDir=resolve(dir,'models/sensevoice');mkdirSync(fixtureDir,{recursive:true});const {copyFileSync}=await import('node:fs');for(const name of ['model.int8.onnx','tokens.txt'])copyFileSync('E:/saves/saves/VRC/VRC气泡字幕/models/sense-voice/'+name,fixtureDir+'/'+name);
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
  let ready=false;
  for(let i=0;i<50;i++) {try {const r=await send("Runtime.evaluate",{expression:"document.body.dataset.ready==='true'",returnByValue:true});if(r.result?.value){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!ready)throw Error('Renderer initialization did not finish');
  const result = await send("Runtime.evaluate", {
    expression: `(async()=>{await window.host.call('load');document.getElementById('connect').click();document.getElementById('text').value='你好，世界！';document.getElementById('test').click();await new Promise(r=>setTimeout(r,3500));await window.host.call('show');await new Promise(r=>setTimeout(r,150));return {text:document.getElementById('bubble').textContent,log:document.getElementById('events').textContent,queue:document.getElementById('queue').textContent};})()`,
    awaitPromise: true,
    userGesture: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw Error(JSON.stringify(result));
  const value = result.result.value;
  if (
    value.text !== "你好，世界！" ||
    /失败|not defined|Cannot|超时/.test(value.log)
  )
    throw Error(JSON.stringify(value));
  await send("Runtime.evaluate", {
    expression: `document.getElementById('endpoint').value='ws://127.0.0.1:9011/?token=本地令牌已隐藏'`,
  });
  const image = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("scratch/ui-preview.png", Buffer.from(image.data, "base64"));
  console.log("PACKAGED_APP_PASS", JSON.stringify(value));
} finally {
  ws?.close();
  child.kill();
}
