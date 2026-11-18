import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";
import WebSocket from "ws";
const dir = resolve("scratch/config-restart-" + Date.now());
mkdirSync(dir, { recursive: true });
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
async function run(phase) {
  const child = spawn(
    resolve(`release/${version}/win-unpacked/ekac-bubble.exe`),
    ["--remote-debugging-port=9230", "--remote-debugging-address=127.0.0.1"],
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
        target = (
          await (await fetch("http://127.0.0.1:9230/json")).json()
        ).find((x) => x.type === "page" && x.url.includes("index.html"));
        if (target) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!target) throw Error("Window unavailable");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await once(ws, "open");
    let id = 0;
    const pending = new Map();
    ws.on("message", (m) => {
      const d = JSON.parse(String(m));
      if (d.id) {
        pending.get(d.id)?.(d);
        pending.delete(d.id);
      }
    });
    const evaluate = (expression) =>
      new Promise((res, rej) => {
        const i = ++id;
        pending.set(i, (d) => {
          if (d.error || d.result?.exceptionDetails)
            rej(Error(JSON.stringify(d)));
          else res(d.result.result.value);
        });
        ws.send(
          JSON.stringify({
            id: i,
            method: "Runtime.evaluate",
            params: {
              expression,
              awaitPromise: true,
              returnByValue: true,
              userGesture: true,
            },
          }),
        );
      });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if (await evaluate("document.body.dataset.ready==='true'")) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!ready) throw Error("Main did not initialize");
    if (phase >= 3) {
      if (phase === 3) {
        await evaluate(`(()=>{
          const values={volume:'.41',pitch:'455',rate:'9','unit-duration':'320',hotkey:'F24'};
          for(const [id,value] of Object.entries(values))document.getElementById(id).value=value;
          for(const id of ['mic','output']){
            const select=document.getElementById(id);
            select.add(new Option('Fixture device','fixture-'+id));select.value='fixture-'+id;
          }
          return true;
        })()`);
      } else {
        const restored = await evaluate(`(()=>{
          const values={};for(const id of ['volume','pitch','rate','unit-duration','hotkey','mic','output'])values[id]=document.getElementById(id).value;
          values.missingMarked=['mic','output'].every(id=>document.getElementById(id).selectedOptions[0]?.disabled && document.getElementById(id).selectedOptions[0]?.textContent.includes('不可用'));
          return values;
        })()`);
        if (restored.volume !== '0.41' || restored.pitch !== '455' || restored.rate !== '9' || restored['unit-duration'] !== '320' ||
            restored.hotkey !== 'F24' || restored.mic !== 'fixture-mic' || restored.output !== 'fixture-output' || !restored.missingMarked)
          throw Error(JSON.stringify(restored));
        console.log('MAIN_CONFIG_CLOSE_RESTART_PASS',JSON.stringify(restored));
      }
      return;
    }
    await evaluate("document.getElementById('audio-test-page').click();true");
    ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if (
          await evaluate(
            "document.getElementById('config-status')?.textContent.includes('配置已载入')",
          )
        ) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!ready) throw Error("Config page did not initialize");
    if (phase === 1) {
      await evaluate(
        `(()=>{const vals={'test-volume':'.37','test-pitch':'488','test-rate':'10','test-unit-duration':'280','audio-text':'配置持久化测试 😀'};for(const [k,v] of Object.entries(vals)){const e=document.getElementById(k);e.value=v;e.dispatchEvent(new Event('input'));}return true;})()`,
      );
    } else {
      const restored = await evaluate(
        `(()=>{const get=id=>document.getElementById(id).value;return {volume:get('test-volume'),pitch:get('test-pitch'),rate:get('test-rate'),unitDurationMs:get('test-unit-duration'),text:get('audio-text'),file:get('config-path')};})()`,
      );
      if (
        restored.volume !== "0.37" ||
        restored.pitch !== "488" ||
        restored.rate !== "10" ||
        restored.unitDurationMs !== "280" ||
        restored.text !== "配置持久化测试 😀"
      )
        throw Error(JSON.stringify(restored));
      console.log("CONFIG_RESTART_PASS", JSON.stringify(restored));
    }
  } finally {
    const exited = once(child, "exit");
    ws?.send(
      JSON.stringify({
        id: 999999,
        method: "Runtime.evaluate",
        params: { expression: "window.close()" },
      }),
    );
    await Promise.race([
      exited,
      new Promise((_, reject) =>
        setTimeout(() => {
          child.kill();
          reject(Error("Graceful close did not finish"));
        }, 10000).unref(),
      ),
    ]);
    ws?.close();
    await new Promise((r) => setTimeout(r, 500));
  }
}
await run(1);
await run(2);
await run(3);
await run(4);
