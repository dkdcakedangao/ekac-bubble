import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const unpacked = `release/${version}/win-unpacked`;
for (const name of [
  "README.md",
  "OSC开启位置.png",
  "MODEL_PROTOCOL.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
])
  copyFileSync(name, `${unpacked}/${name}`);

if (existsSync("release/ekac气泡插件.unitypackage")) {
  copyFileSync("release/ekac气泡插件.unitypackage", `${unpacked}/ekac气泡插件.unitypackage`);
}

// Newly written Electron executables can be briefly locked by Windows Defender during scanning.
let status = 1;
for (let attempt = 0; attempt < 5; attempt++) {
  if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
  const r = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath '${unpacked}' -DestinationPath 'release/ekac-bubble-${version}-win-x64.zip' -Force`,
    ],
    { stdio: "inherit", windowsHide: true },
  );
  status = r.status ?? 1;
  if (status === 0) break;
}
process.exit(status);
