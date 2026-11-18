import { test } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import { once } from "node:events";
import WebSocket from "ws";
import { join } from "node:path";
import { Chatbox, chatPacket, chunks, ModelPort } from "../src/transport";
import { SpeechText } from "../vendor/speech/index";
import { VoiceClock } from "../web/speech.js";
test("OSC UTF-8 packet reaches real UDP receiver, preserves bool tags and clear", async () => {
  const server = dgram.createSocket("udp4");
  server.bind(0, "127.0.0.1");
  await once(server, "listening");
  const client = new Chatbox("127.0.0.1", (server.address() as any).port);
  try {
    let received = once(server, "message");
    await client.send("你好");
    assert.deepEqual((await received)[0], chatPacket("你好"));
    received = once(server, "message");
    await client.clear();
    assert.deepEqual((await received)[0], chatPacket(""));
  } finally {
    client.close();
    server.close();
  }
});
test("long Unicode text splits without loss or surrogate damage", () => {
  const text = "你好😀".repeat(200) + "。Hello!";
  const c = chunks(text);
  assert.equal(c.join(""), text);
  assert.ok(c.every((p) => [...p].length <= 144));
});
test("model authenticates, reconnects with current reveal state and clears on cancel", async () => {
  const port = new ModelPort();
  await port.start(0);
  const address = (port as any).server.address();
  const url = `ws://127.0.0.1:${address.port}/?token=${port.token}`;
  let ws = new WebSocket(url);
  try {
    let event = once(ws, "message");
    await once(ws, "open");
    assert.equal(JSON.parse(String((await event)[0])).state, null);
    event = once(ws, "message");
    port.publish({ type: "begin", id: "1", text: "你好" });
    assert.equal(JSON.parse(String((await event)[0])).type, "begin");
    port.publish({ type: "reveal", id: "1", count: 1, elapsedMs: 50 });
    ws.close();
    ws = new WebSocket(url);
    event = once(ws, "message");
    await once(ws, "open");
    assert.equal(JSON.parse(String((await event)[0])).state.count, 1);
    event = once(ws, "message");
    port.publish({ type: "cancel", id: "1" });
    assert.equal(JSON.parse(String((await event)[0])).type, "cancel");
    const bad = new WebSocket(`ws://127.0.0.1:${address.port}/`);
    const [code] = await once(bad, "close");
    assert.equal(code, 1008);
  } finally {
    ws.close();
    port.close();
  }
});
test("Coopanion pronunciations and voice-clock timing remain intact", () => {
  const speech = new SpeechText(
    join(process.cwd(), "vendor/speech/data"),
    join(process.cwd(), "web/speech/zh.json"),
  );
  assert.deepEqual(
    speech.units("你好", "zh-CN").map((u) => u.key),
    ["ni", "hao"],
  );
  assert.ok(speech.units("hello 123!", "zh-CN").length > 3);
  const c = new VoiceClock();
  assert.equal(c.place(0, { weak: false, final: true }, 13, 0.1), 0);
  c.mark("。");
  assert.ok(c.place(0, { weak: false, final: true }, 13, 0.1)! >= 0.55);
  c.free = 3;
  // Long or heavily lagged syllables are queued instead of dropped.
  assert.equal(c.place(0, { weak: true, final: false }, 13, 0.4), 3);
  assert.ok(c.place(0, { weak: false, final: false }, 13, 0.4)! >= 3.4 - 1e-9);
});

test("concurrent Chatbox submissions retain order and rate limit", async () => {const server=dgram.createSocket('udp4');server.bind(0,'127.0.0.1');await once(server,'listening');const client=new Chatbox('127.0.0.1',(server.address() as any).port);const seen:Array<{packet:Buffer,time:number}>=[];server.on('message',packet=>seen.push({packet,time:Date.now()}));try{await Promise.all([client.send('第一句'),client.send('第二句')]);await new Promise(r=>setTimeout(r,30));assert.equal(seen.length,2);assert.deepEqual(seen[0].packet,chatPacket('第一句'));assert.deepEqual(seen[1].packet,chatPacket('第二句'));assert.ok(seen[1].time-seen[0].time>=1450);}finally{client.close();server.close();}});
