import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadAudioConfig,
  saveAudioConfig,
  AudioConfigWriter,
} from "../src/audio-config";
const defaults = {
  output: "",
  volume: 0.6,
  pitch: 400,
  rate: 13,
  unitDurationMs: 100,
  text: "测试文字",
};
test("test configuration persists Unicode and device independently of main settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "bubble-config-")),
    file = join(root, "audio-test.json"),
    main = join(root, "settings.json");
  writeFileSync(main, '{"volume":0.8}');
  assert.deepEqual(await loadAudioConfig(file, defaults), defaults);
  writeFileSync(file, JSON.stringify({ output: "", volume: 0.6, pitch: 400, rate: 13, text: "无时长字段" }));
  assert.equal((await loadAudioConfig(file, defaults)).unitDurationMs, 100);
  const changed = {
    output: "voicemeeter-id",
    volume: 0.37,
    pitch: 488,
    rate: 10,
    unitDurationMs: 300,
    text: "中文 abc 123 😀",
  };
  await saveAudioConfig(file, changed);
  assert.deepEqual(await loadAudioConfig(file, defaults), changed);
  assert.equal(readFileSync(main, "utf8"), '{"volume":0.8}');
});
test("invalid writes and corrupt JSON do not overwrite previous configuration", async () => {
  const file = join(
    mkdtempSync(join(tmpdir(), "bubble-config-")),
    "audio-test.json",
  );
  await saveAudioConfig(file, defaults);
  const before = readFileSync(file, "utf8");
  await assert.rejects(() => saveAudioConfig(file, { ...defaults, pitch: 0 }));
  for (const unitDurationMs of [0, 59, 401, NaN, Infinity])
    await assert.rejects(() => saveAudioConfig(file, { ...defaults, unitDurationMs }));
  assert.equal(readFileSync(file, "utf8"), before);
  writeFileSync(file, "broken json");
  await assert.rejects(() => loadAudioConfig(file, defaults));
  assert.equal(readFileSync(file, "utf8"), "broken json");
});

test("rapid edits combine, and flush waits for writes and newer edits", async () => {
  const file = join(
    mkdtempSync(join(tmpdir(), "bubble-batch-")),
    "audio-test.json",
  );
  const writes: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  const writer = new AudioConfigWriter(file, async (path, config) => {
    writes.push(config.text);
    if (writes.length === 1) await blocked;
    return saveAudioConfig(path, config);
  });
  const first = writer.update({ ...defaults, text: "first" });
  const second = writer.update({ ...defaults, text: "combined" });
  let ended = false;
  const flushing = writer.flush().then(() => {
    ended = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(ended, false);
  assert.deepEqual(writes, ["combined"]);
  const latest = writer.update({ ...defaults, text: "last edit" });
  release();
  await Promise.all([first, second, latest, flushing]);
  assert.deepEqual(writes, ["combined", "last edit"]);
  assert.equal((await loadAudioConfig(file, defaults)).text, "last edit");
});
test("failed async save blocks close flush and a corrected update can recover", async () => {
  const file = join(
    mkdtempSync(join(tmpdir(), "bubble-retry-")),
    "audio-test.json",
  );
  let failing = true;
  const writer = new AudioConfigWriter(file, async (path, cfg) => {
    if (failing) throw Error("disk unavailable");
    return saveAudioConfig(path, cfg);
  });
  const update = writer.update(defaults);
  const rejection = assert.rejects(update, /disk unavailable/);
  await assert.rejects(writer.flush(), /disk unavailable/);
  await rejection;
  await assert.rejects(writer.flush(), /disk unavailable/);
  failing = false;
  const retry = writer.update({ ...defaults, text: "recovered" });
  await writer.flush();
  await retry;
  assert.equal((await loadAudioConfig(file, defaults)).text, "recovered");
});
