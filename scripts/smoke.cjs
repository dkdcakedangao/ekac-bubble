const { app, BrowserWindow } = require("electron");
const fs = require("fs"),
  path = require("path");
app.setAppPath(path.resolve("."));
const dir = path.resolve("scratch/smoke-data");
fs.mkdirSync(dir, { recursive: true });
process.env.EKAC_BUBBLE_DATA = dir;
fs.writeFileSync(
  path.join(dir, "settings.json"),
  JSON.stringify({
    modelDir: "E:/saves/saves/VRC/VRC气泡字幕/models/sense-voice",
    mode: "model",
    sound: true,
  }),
);
const timeout = setTimeout(() => {
  console.error("SMOKE_TIMEOUT");
  app.exit(1);
}, 45000);
app.on("browser-window-created", (_, win) =>
  win.webContents.once("did-finish-load", async () => {
    try {
      await new Promise((r) => setTimeout(r, 800));
      const result = await win.webContents.executeJavaScript(
        `(async()=>{await window.host.call('load');document.getElementById('connect').click();document.getElementById('text').value='你好，世界！';document.getElementById('test').click();await new Promise(r=>setTimeout(r,1800));const visible=document.getElementById('bubble').textContent;const remote=document.getElementById('remote').textContent;const errors=document.getElementById('events').textContent;document.getElementById('stop').click();await new Promise(r=>setTimeout(r,100));return {visible,remote,errors,stopped:document.getElementById('bubble').textContent};})()`,
        true,
      );
      if (
        !result.visible.startsWith("你") ||
        !result.remote.startsWith("你") ||
        result.stopped !== "已停止" ||
        /失败|超时|not defined|Cannot/i.test(result.errors)
      )
        throw Error(JSON.stringify(result));
      console.log("ELECTRON_SMOKE_PASS", JSON.stringify(result));
      const image = await win.webContents.capturePage();
      fs.writeFileSync("scratch/ui-preview.png", image.toPNG());
      clearTimeout(timeout);
      app.exit(0);
    } catch (e) {
      console.error(e);
      app.exit(1);
    }
  }),
);
require("../dist/main.cjs");
