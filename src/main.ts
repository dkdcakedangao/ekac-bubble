import { loadAudioConfig, AudioConfigWriter } from "./audio-config";
import {
  app,
  BrowserWindow,
  Tray,
  nativeImage,
  Menu,
  nativeTheme,
  ipcMain,
  dialog,
  globalShortcut,
  shell,
} from "electron";
import { join, dirname } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  unlinkSync,
  accessSync,
  constants,
  promises as fs,
} from "node:fs";
import { Asr } from "./asr";
import { OutputRouter } from "./output-router";
import { AsrService } from "./asr-service";
import { SpeechText } from "../vendor/speech/index";
import { GlyphLookup, layoutVrcBubbles } from "./vrc-bubble-layout";
import { MAX_SUFFIX_LENGTH, normalizeSuffixText } from "./sentence-suffix";
let win: BrowserWindow;
let asr: Asr;
let engine: AsrService;
let tray: Tray;
let listening = false;
const router = new OutputRouter();
let hotkeyTimer: ReturnType<typeof setTimeout> | undefined;
let hotkeyRegistered = false;
let loading = false;
const root = app.getAppPath();
const dataDir =
  process.env.EKAC_BUBBLE_DATA ||
  join(app.isPackaged ? dirname(process.execPath) : root, "data");
try {
  mkdirSync(dataDir, { recursive: true });
  accessSync(dataDir, constants.W_OK);
  const probe = join(dataDir, ".write-test-" + process.pid);
  writeFileSync(probe, "ok", { flag: "wx" });
  unlinkSync(probe);
} catch (error) {
  dialog.showErrorBox(
    "ekac-bubble 无法写入便携目录",
    "请将软件放到可写文件夹。\n" + String(error),
  );
  app.exit(1);
}
app.setPath("userData", dataDir);
const modelDir = join(dataDir, "models", "sensevoice");
let settings: any = {
  mode: "general",
  capture: "hold",
  sound: true,
  volume: 0.6,
  pitch: 400,
  rate: 13,
  unitDurationMs: 100,
  hotkey: "F8",
  mic: "",
  output: "",
  suffixEnabled: false,
  suffixText: "喵",
};
const tell = (type: string, data: any) => {
  if (win && !win.isDestroyed()) win.webContents.send("event", { type, data });
};
function log(s: string) {
  appendFileSync(
    join(app.getPath("userData"), "run.log"),
    new Date().toISOString() + " " + s + "\n",
  );
  tell("status", s);
}
const user32 = require("koffi").load("user32.dll");
const keyState = user32.func("short __stdcall GetAsyncKeyState(int)");
function key(value = settings.hotkey) {
  const key = value.toUpperCase();
  const code = /^F([1-9]|1[0-9]|2[0-4])$/.test(key)
    ? 111 + Number(key.slice(1))
    : /^[A-Z0-9]$/.test(key)
      ? key.charCodeAt(0)
      : 0;
  if (!code) throw Error("快捷键支持 F1–F24 或单个字母数字");
  globalShortcut.unregisterAll();
  if (hotkeyTimer) clearInterval(hotkeyTimer);
  if (
    !globalShortcut.register(key, () => {
      tell("hold", true);
      if (hotkeyTimer) clearInterval(hotkeyTimer);
      hotkeyTimer = setInterval(() => {
        if (!(keyState(code) & 0x8000)) {
          if (hotkeyTimer) clearInterval(hotkeyTimer);
          tell("hold", false);
        }
      }, 25);
    })
  )
    throw Error("快捷键已被占用");
  hotkeyRegistered = true;
}
app.whenReady().then(async () => {
  app.setAppUserModelId("local.ekacbubble.desktop");
  Menu.setApplicationMenu(null);
  nativeTheme.themeSource = "light";
  const file = join(app.getPath("userData"), "settings.json");
  try {
    if (existsSync(file))
      settings = { ...settings, ...JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    log("设置文件损坏，使用默认设置");
  }
  asr = new Asr(modelDir, log);
  engine = new AsrService(root, log);
  let outputError = "";
  try {
    await router.setMode(settings.mode);
  } catch (error) {
    outputError = "输出端口未启用：" + String(error);
    log(outputError);
  }
  const speech = new SpeechText(
    join(root, "vendor/speech/data"),
    join(root, "web/speech/zh.json"),
  );
  const glyphLookup = new GlyphLookup(
    JSON.parse(readFileSync(join(root, "web/bubble-glyphs.json"), "utf8")),
  );
  const audioConfigPath = join(app.getPath("userData"), "audio-test.json");
  const audioWriter = new AudioConfigWriter(audioConfigPath);
  ipcMain.handle("command", async (_, cmd: string, data: any) => {
    try {
      switch (cmd) {
        case "open-app-menu": {
          const items: Record<string, Electron.MenuItemConstructorOptions[]> = {
            file: [
              { label: "收起到托盘", click: () => win.hide() },
              { type: "separator" },
              {
                label: "打开配置文件夹",
                click: () => {
                  void shell.openPath(dataDir);
                },
              },
              { type: "separator" },
              { label: "关闭窗口", click: () => win.close() },
            ],
            edit: [
              { label: "撤销", role: "undo" },
              { label: "重做", role: "redo" },
              { type: "separator" },
              { label: "剪切", role: "cut" },
              { label: "复制", role: "copy" },
              { label: "粘贴", role: "paste" },
              { type: "separator" },
              { label: "全选", role: "selectAll" },
            ],
            view: [
              { label: "放大界面", role: "zoomIn" },
              { label: "缩小界面", role: "zoomOut" },
              { label: "重置缩放", role: "resetZoom" },
              { type: "separator" },
              { label: "切换全屏", role: "togglefullscreen" },
            ],
            window: [
              { label: "最小化", role: "minimize" },
              {
                label: "切换最大化",
                click: () =>
                  win.isMaximized() ? win.unmaximize() : win.maximize(),
              },
            ],
            help: [
              {
                label: "使用说明",
                click: () => {
                  void shell.openPath(
                    app.isPackaged
                      ? join(process.resourcesPath, "..", "README.md")
                      : join(root, "README.md"),
                  );
                },
              },
              {
                label: "关于 ekac-bubble",
                click: () => {
                  void dialog.showMessageBox(win, {
                    type: "info",
                    title: "关于 ekac-bubble",
                    message: "ekac-bubble",
                    detail:
                      "版本 " +
                      app.getVersion() +
                      "\n本地语音识别、短音节声音与游戏字幕。",
                    buttons: ["知道了"],
                  });
                },
              },
            ],
          };
          if (
            !data ||
            !Object.hasOwn(items, data.name) ||
            !Number.isFinite(data.x) ||
            !Number.isFinite(data.y)
          )
            throw Error("菜单请求无效");
          const bounds = win.getContentBounds();
          await new Promise<void>((resolve) =>
            Menu.buildFromTemplate(items[data.name]).popup({
              window: win,
              x: Math.max(0, Math.min(bounds.width, Math.round(data.x))),
              y: Math.max(0, Math.min(bounds.height, Math.round(data.y))),
              callback: resolve,
            }),
          );
          return true;
        }
        case "open-official": {
          const urls: Record<string, string> = {
            voicemeeter: "https://vb-audio.com/Voicemeeter/banana.htm",
            "voicemeeter-guide": "https://voicemeeter.com/quick-tips-voicemeeter-virtual-inputs-and-outputs-windows-10-and-up/",
            "vrchat-osc": "https://docs.vrchat.com/docs/osc-overview",
          };
          if (typeof data !== "string" || !Object.hasOwn(urls, data))
            throw Error("未知的官方教程链接");
          await shell.openExternal(urls[data]);
          return true;
        }
        case "show":
          win.show();
          win.focus();
          return true;
        case "hide":
          win.hide();
          return true;
        case "unload":
          engine.stop();
          return true;
        case "listening":
          listening = !!data;
          updateTray();
          return true;
        case "runtime-state":
          return {
            asrPid: engine.pid,
            mode: router.mode,
            modelUrl: router.modelUrl,
            visible: win.isVisible(),
            processes: app.getAppMetrics().map((p) => ({
              type: p.type,
              name: p.name,
              memoryKB: p.memory.workingSetSize,
              cpu: p.cpu.percentCPUUsage,
            })),
          };
        case "init":
          return {
            settings,
            outputError,
            visible: win.isVisible() && !win.isMinimized(),
            modelUrl: router.modelUrl,
          };
        case "audio-test-config": {
          try {
            return {
              path: audioConfigPath,
              settings: await loadAudioConfig(audioConfigPath, {
                output: settings.output,
                volume: settings.volume,
                pitch: settings.pitch,
                rate: settings.rate,
                unitDurationMs: settings.unitDurationMs,
                text: "你好，这是音频输出测试。今天也要开心！",
              }),
            };
          } catch (e) {
            return {
              path: audioConfigPath,
              error:
                "配置文件无法读取，请修正 JSON 后重新进入：" +
                (e as Error).message,
            };
          }
        }
        case "save-audio-test":
          await audioWriter.update(data);
          return true;
        case "flush-audio-config":
          await audioWriter.flush();
          return true;
        case "show-audio-config":
          shell.showItemInFolder(audioConfigPath);
          return true;
        case "save": {
          const next = {
            ...settings,
            ...data,
            suffixEnabled: Boolean(data?.suffixEnabled ?? settings.suffixEnabled),
            suffixText:
              data?.suffixText !== undefined
                ? data.suffixText
                : (settings.suffixText ?? "喵"),
          };
          if (
            !["general", "chatbox", "model"].includes(next.mode) ||
            !["hold", "continuous"].includes(next.capture) ||
            typeof next.suffixText !== "string" ||
            Array.from(next.suffixText).length > MAX_SUFFIX_LENGTH ||
            !Number.isFinite(next.pitch) ||
            next.pitch < 200 ||
            next.pitch > 800 ||
            !Number.isFinite(next.rate) ||
            next.rate < 4 ||
            next.rate > 25 ||
            !Number.isFinite(next.unitDurationMs) ||
            next.unitDurationMs < 60 ||
            next.unitDurationMs > 400 ||
            !Number.isFinite(next.volume) ||
            next.volume < 0 ||
            next.volume > 1
          )
            throw Error("设置无效");
          next.suffixText = normalizeSuffixText(next.suffixText);
          if (!hotkeyRegistered || next.hotkey !== settings.hotkey) {
            key(next.hotkey);
          }
          await router.setMode(next.mode);
          settings = next;
          writeFileSync(file, JSON.stringify(settings, null, 2));
          return { modelUrl: router.modelUrl };
        }
        case "choose-model": {
          const selected = await dialog.showOpenDialog(win, {
            properties: ["openDirectory"],
          });
          if (selected.canceled) return null;
          engine.stop();
          const source = selected.filePaths[0];
          await new Asr(source, log).verify();
          await fs.mkdir(modelDir, { recursive: true });
          for (const name of ["model.int8.onnx", "tokens.txt"]) {
            if (join(source, name) !== join(modelDir, name))
              await fs.copyFile(join(source, name), join(modelDir, name));
          }
          await asr.verify();
          log("识别模型已导入便携目录");
          return modelDir;
        }
        case "load":
        case "download":
          if (loading) throw Error("模型正在加载或下载");
          loading = true;
          try {
            if (cmd === "download") await asr.download();
            await engine.load(modelDir);
            return true;
          } finally {
            loading = false;
          }
        case "decode":
          return await engine.decode(new Int16Array(data));
        case "units":
          return speech.units(String(data), "zh-CN");
        case "chat":
          await router.send(String(data));
          log("Chatbox 已发送（UDP，无接收确认）");
          return true;
        case "cancel":
          router.cancel(data);
          return true;
        case "clear-chat":
          await router.clear();
          return true;
        case "clear-model":
          router.clearModel();
          return true;
        case "model-layout":
          return layoutVrcBubbles(String(data ?? ""), glyphLookup);
        case "model-chunk":
          if (!data || typeof data.len !== "number" || !Array.isArray(data.glyphs))
            throw Error("模型气泡分片无效");
          router.sendModelChunk(data);
          return true;
        case "model":
          if (!["begin", "reveal", "end", "cancel"].includes(data?.type))
            throw Error("协议消息无效");
          router.publish(data);
          return true;
        default:
          throw Error("未知命令");
      }
    } catch (e) {
      log((e as Error).message);
      throw e;
    }
  });
  win = new BrowserWindow({
    width: 1240,
    minWidth: 940,
    minHeight: 680,
    height: 900,
    title: "ekac-bubble",
    backgroundColor: "#fff8f3",
    icon: join(root, "web/assets/app.ico"),
    webPreferences: {
      preload: join(root, "dist/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  tray = new Tray(
    nativeImage.createFromPath(join(root, "web/assets/tray.png")),
  );
  function updateTray() {
    tray.setToolTip("ekac-bubble · " + (listening ? "正在监听" : "未监听"));
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "显示主界面",
          click: () => {
            win.show();
            win.focus();
          },
        },
        {
          label: listening ? "停止监听" : "开始监听",
          click: () =>
            tell(
              win.webContents.getURL().includes("audio-test.html")
                ? "listen-from-tray"
                : "toggle-listen",
              null,
            ),
        },
        { label: "停止播放并清空", click: () => tell("stop-playback", null) },
        { type: "separator" },
        { label: "退出 ekac-bubble", click: () => win.close() },
      ]),
    );
  }
  updateTray();
  tray.on("double-click", () => {
    win.show();
    win.focus();
  });
  win.on("minimize", () => tell("visibility", false));
  win.on("restore", () => tell("visibility", true));
  win.on("show", () => tell("visibility", true));
  win.on("hide", () => tell("visibility", false));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await win.loadFile(join(root, "web/index.html"));
  try {
    key();
  } catch (e) {
    log((e as Error).message);
  }
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  engine?.stop();
  tray?.destroy();
  void router.close();
});
