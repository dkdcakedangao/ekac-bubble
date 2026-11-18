import { build } from "esbuild";
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/main.cjs",
  external: ["electron", "sherpa-onnx-node", "koffi"],
  define: { "import.meta.url": "__filename" },
});
await build({
  entryPoints: ["src/asr-worker.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/asr-worker.cjs",
  external: ["sherpa-onnx-node"],
  define: { "import.meta.url": "__filename" },
});
await build({
  entryPoints: { app: "src/renderer.ts", "audio-test": "src/audio-test.ts" },
  bundle: true,
  platform: "browser",
  format: "esm",
  outdir: "web",
  entryNames: "[name]",
});

import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("dist", { recursive: true });
copyFileSync("src/preload.cjs", "dist/preload.cjs");
