import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import WebSocket from "ws";
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const dir = resolve("scratch/ui-" + Date.now());
mkdirSync(dir, { recursive: true });
writeFileSync(
  dir + "/settings.json",
  JSON.stringify({
    modelDir: "E:/saves/saves/VRC/VRC气泡字幕/models/sense-voice",
    mode: "general",
    sound: true,
    hotkey: "F24",
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
  const startupDevices = await send('Runtime.evaluate', {
    expression: `(async()=>{
      const outputs=document.getElementById('output');
      const microphones=document.getElementById('mic');
      const available=await navigator.mediaDevices.enumerateDevices();
      return {outputCount:outputs.options.length,selected:outputs.selectedIndex,
        defaultLabel:outputs.querySelector('option[value=""]')?.textContent,
        complete:available.filter(d=>['audioinput','audiooutput'].includes(d.kind) && d.deviceId && d.deviceId!=='default').every(d=>
          [...(d.kind==='audioinput'?microphones:outputs).options].some(o=>o.value===d.deviceId && (!d.label || o.textContent===d.label)))};
    })()`, awaitPromise:true, returnByValue:true,
  });
  const startup=startupDevices.result?.value;
  if (!startup || startup.outputCount<1 || startup.selected<0 || startup.defaultLabel!=='系统默认' || !startup.complete)
    throw Error('Startup devices missing before refresh '+JSON.stringify(startupDevices));
  const toastCheck = await send("Runtime.evaluate", {
    expression: `(async()=>{
      const wait=async(test)=>{for(let i=0;i<150;i++){if(await test())return;await new Promise(r=>setTimeout(r,50));}throw Error('Toast timeout');};
      const current=()=>document.getElementById('app-toast');
      const message=()=>current()?.querySelector('.toast-message')?.textContent;
      document.getElementById('save').click();
      await wait(()=>!current()?.hidden && message()==='设置已保存');
      const success=current().dataset.kind;
      document.querySelector('.toast-close').click();
      if(!current().hidden)throw Error('Toast dismiss failed');
      document.getElementById('stop').click();
      if(current().hidden || message()!=='已停止播放并清空队列')throw Error('Toast replacement failed');
      await new Promise(r=>setTimeout(r,3700));
      if(!current().hidden)throw Error('Toast did not expire');
      document.getElementById('pitch').value='999';
      document.getElementById('save').click();
      await wait(()=>!current().hidden && current().dataset.kind==='error');
      const error=message();
      document.getElementById('pitch').value='400';
      document.getElementById('listen').click();
      if(message()!=='正在启动监听，请稍候…')throw Error('Missing startup feedback');
      await wait(()=>current().dataset.kind==='error' && message().includes('缺少 model.int8.onnx'));
      if((await window.host.call('runtime-state')).asrPid)throw Error('Failed start leaked worker');
      document.querySelector('.toast-close').click();
      document.getElementById('save').click();
      await wait(()=>!current().hidden && message()==='设置已保存');
      return {success,error,count:document.querySelectorAll('.toast').length};
    })()`,
    awaitPromise: true, returnByValue: true,
  });
  if(toastCheck.exceptionDetails || toastCheck.result?.value?.success!=='success' ||
      toastCheck.result?.value?.error!=='设置无效' || toastCheck.result?.value?.count!==1)
    throw Error(JSON.stringify(toastCheck));
  const toastImage = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(`scratch/ui-toast-${version}.png`,Buffer.from(toastImage.data,'base64'));
  await send('Runtime.evaluate',{expression:"document.querySelector('.toast-close').click()"});
  for (const width of [1240, 940]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const check = await send("Runtime.evaluate", {
      expression: `(()=>{
        const sidebar=document.querySelector('.sidebar');const toast=document.getElementById('app-toast');
        toast.hidden=false;const rect=toast.getBoundingClientRect();toast.hidden=true;
        return {overflow:document.documentElement.scrollWidth>innerWidth,sidebar:getComputedStyle(sidebar).position,
          nav:document.querySelectorAll('.nav-item').length,toastFits:rect.left>=0 && rect.right<=innerWidth && rect.top>=34 && getComputedStyle(toast).position==='fixed'};
      })()`,
      returnByValue: true,
    });
    if (
      check.result.value.overflow ||
      check.result.value.sidebar !== "fixed" ||
      check.result.value.nav !== 4 || !check.result.value.toastFits
    )
      throw Error(JSON.stringify(check));
  }
  await send("Runtime.evaluate", {
    expression: "document.getElementById('model-nav').click()",
  });
  let state = await send("Runtime.evaluate", {
    expression:
      "!document.getElementById('model-panel').hidden && document.getElementById('workspace-panel').hidden && document.getElementById('page-title').textContent==='模型端口'",
    returnByValue: true,
  });
  if (!state.result.value) throw Error("Model nav failed");
  await send("Runtime.evaluate", {
    expression: "document.getElementById('tutorial-nav').click()",
  });
  for (const width of [1240, 940]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height: 1050, deviceScaleFactor: 1, mobile: false,
    });
    const tutorial = await send("Runtime.evaluate", {
      expression: `(async()=>{
        const panel=document.getElementById('tutorial-panel');
        const image=panel.querySelector('.tutorial-osc img');
        image.loading='eager';await image.decode();
        const rect=image.getBoundingClientRect();
        return {shown:!panel.hidden,title:document.getElementById('page-title').textContent,
          overflow:document.documentElement.scrollWidth>innerWidth,
          workspaceHidden:document.getElementById('workspace-panel').hidden,
          modelHidden:document.getElementById('model-panel').hidden,
          active:document.getElementById('tutorial-nav').getAttribute('aria-current'),
          hash:location.hash,links:[...panel.querySelectorAll('a')].map(a=>a.href),
          imageLoaded:image.naturalWidth===1484 && image.naturalHeight===404,
          imageFits:rect.left>=0 && rect.right<=innerWidth && Math.abs(rect.width/rect.height-1484/404)<0.01};
      })()`,
      awaitPromise:true, returnByValue: true,
    });
    const value = tutorial.result.value;
    if (!value.shown || value.title !== '教程' || value.overflow || !value.workspaceHidden ||
        !value.modelHidden || value.active !== 'page' || value.hash !== '#tutorial' ||
        !value.links.includes('https://vb-audio.com/Voicemeeter/banana.htm') || value.links.length !== 3 || !value.imageLoaded || !value.imageFits)
      throw Error(JSON.stringify(tutorial));
  }
  for (const [width, height] of [[1240, 900], [940, 680]]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    const scroll = await send("Runtime.evaluate", {
      expression: `(async()=>{
        const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        document.getElementById('tutorial-nav').click();
        window.scrollTo(0,document.documentElement.scrollHeight);
        await frame();
        const tutorialBottom=scrollY;
        document.getElementById('workspace-nav').click();
        await frame();
        const workspaceScroll=scrollY;
        const button=document.getElementById('listen').getBoundingClientRect();
        document.getElementById('tutorial-nav').click();
        await frame();
        return {tutorialBottom,workspaceScroll,tutorialScroll:scrollY,
          listenVisible:button.top>=0 && button.bottom<=innerHeight};
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const value=scroll.result?.value;
    if (!value || value.tutorialBottom<=0 || value.workspaceScroll!==0 ||
        value.tutorialScroll!==0 || !value.listenVisible)
      throw Error('Tab scroll regression '+width+'x'+height+' '+JSON.stringify(scroll));
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1240, height: 1180, deviceScaleFactor: 1, mobile: false,
  });
  const metrics = await send('Page.getLayoutMetrics', {});
  const tutorialImage = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: {x:0,y:0,width:1240,height:metrics.cssContentSize.height,scale:1},
  });
  writeFileSync(`scratch/ui-tutorial-${version}.png`,Buffer.from(tutorialImage.data,'base64'));
  const linkGuard = await send("Runtime.evaluate", {
    expression: "window.host.call('open-official','unknown').then(()=>false,()=>true)",
    awaitPromise: true, returnByValue: true,
  });
  if (!linkGuard.result.value) throw Error('Unknown external link was allowed');
  await send("Runtime.evaluate", {
    expression: "document.getElementById('workspace-nav').click()",
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1240,
    height: 1180,
    deviceScaleFactor: 1,
    mobile: false,
  });
  let image = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    `scratch/ui-workspace-${version}.png`,
    Buffer.from(image.data, "base64"),
  );
  await send("Runtime.evaluate", {
    expression: "document.getElementById('audio-test-page').click()",
  });
  for (let i = 0; i < 80; i++) {
    try {
      const r = await send("Runtime.evaluate", {
        expression:
          "document.getElementById('config-status')?.textContent.includes('配置已载入')",
        returnByValue: true,
      });
      if (r.result?.value) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const width of [1240, 940]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const r = await send("Runtime.evaluate", {
      expression: "document.documentElement.scrollWidth<=innerWidth",
      returnByValue: true,
    });
    if (!r.result.value) throw Error("Audio page overflow " + width);
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1240,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const audioToast=await send('Runtime.evaluate',{
    expression:`(()=>{
      const input=document.getElementById('audio-text');const previous=input.value;
      input.value='';document.getElementById('play-audio').click();
      const bubble=document.getElementById('app-toast');
      const result=!!bubble && !bubble.hidden && bubble.dataset.kind==='error' && bubble.querySelector('.toast-message').textContent==='请输入测试文字';
      input.value=previous;document.querySelector('.toast-close')?.click();return result;
    })()`,returnByValue:true,
  });
  if(!audioToast.result?.value)throw Error('Audio test toast missing');
  image = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    `scratch/ui-audio-${version}.png`,
    Buffer.from(image.data, "base64"),
  );
  await send("Runtime.evaluate", {
    expression: `(()=>{const e=document.getElementById('audio-text');e.value='导航保存测试';e.dispatchEvent(new Event('input'));document.querySelector('a[href="index.html#model"]').click();})()`,
  });
  let returned = false;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await send("Runtime.evaluate", {
        expression:
          "document.getElementById('page-title')?.textContent==='模型端口'",
        returnByValue: true,
      });
      if (r.result?.value) {
        returned = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!returned) throw Error("Audio-to-model navigation failed");
  const fs = await import("node:fs");
  if (
    JSON.parse(fs.readFileSync(dir + "/audio-test.json", "utf8")).text !==
    "导航保存测试"
  )
    throw Error("Navigation lost edit");
  await send('Runtime.evaluate', {expression:"document.getElementById('audio-test-page').click()"});
  let audioReady = false;
  for(let i=0;i<80;i++) {
    try {
      const r=await send('Runtime.evaluate',{expression:"document.getElementById('config-status')?.textContent.includes('配置已载入')",returnByValue:true});
      if(r.result?.value){audioReady=true;break;}
    }catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  if(!audioReady)throw Error('Audio page did not load for tutorial navigation');
  await send('Runtime.evaluate',{expression:`document.querySelector('a[href="index.html#tutorial"]').click()`});
  let tutorialReturned=false;
  for(let i=0;i<80;i++) {
    try {
      const r=await send('Runtime.evaluate',{expression:"document.body.dataset.ready==='true' && document.getElementById('page-title')?.textContent==='教程' && !document.getElementById('tutorial-panel').hidden",returnByValue:true});
      if(r.result?.value){tutorialReturned=true;break;}
    }catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  if(!tutorialReturned)throw Error('Audio-to-tutorial navigation failed');
  console.log(
    "UI_LAYOUT_PASS startupDevices=true widths=1240,940 toast=true toastExpiry=true toastDismiss=true audioToast=true sidebar=fixed nav=4 tutorial=true scrollReset=true listenVisible=true officialLinks=3 audioToTutorial=true modelPanel=true audioToModel=true savedOnNavigate=true",
  );
} finally {
  ws?.close();
  child.kill();
}
