import { test } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import net from "node:net";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GlyphLookup,
  layoutVrcBubbles,
  MAX_CHARS_PER_BUBBLE,
  MAX_LINE_ADVANCE,
} from "../src/vrc-bubble-layout";
import {
  encodeOscMessage,
  VrcBubbleOscSender,
} from "../src/vrc-osc-sender";
import { OutputRouter } from "../src/output-router";

function decodeOsc(buf: Buffer) {
  let off = 0;
  const readStr = () => {
    const end = buf.indexOf(0, off);
    const str = buf.toString("utf8", off, end);
    off = end + 1 + ((4 - ((end + 1) % 4)) % 4);
    return str;
  };
  const address = readStr();
  const tags = readStr().slice(1);
  const args: Array<number | boolean> = [];
  for (const t of tags) {
    if (t === "i") {
      args.push(buf.readInt32BE(off));
      off += 4;
    } else if (t === "f") {
      args.push(buf.readFloatBE(off));
      off += 4;
    } else if (t === "T") {
      args.push(true);
    } else if (t === "F") {
      args.push(false);
    }
  }
  return { address, tags, args };
}

const atlasJson = JSON.parse(
  readFileSync(join(process.cwd(), "web/bubble-glyphs.json"), "utf8"),
);
const lookup = new GlyphLookup(atlasJson);

test("glyph lookup encodes CJK, colloquial particles, ASCII tiers and unknown fallback", () => {
  const you = lookup.get("你");
  const en = lookup.get("嗯");
  const miao = lookup.get("喵");
  const space = lookup.get(" ");
  const letterI = lookup.get("i");
  const letterA = lookup.get("a");
  const letterW = lookup.get("W");
  assert.ok(you.row >= 2 && you.advance === 1.0);
  assert.ok(en.row >= 2 && en.advance === 1.0);
  assert.ok(miao.row >= 2 && miao.advance === 1.0);
  assert.equal(space.col, 1);
  assert.equal(space.row, 0);
  assert.equal(letterI.advance, 0.36);
  assert.equal(letterA.advance, 0.6);
  assert.equal(letterW.advance, 1.0);

  const rare = lookup.get("𠮷");
  assert.deepEqual(rare, lookup.fallback);
});

test("layout wraps lines by proportional width, respects kinsoku, and splits overflow into new bubbles", () => {
  const short = layoutVrcBubbles("你好世界！", lookup);
  assert.equal(short.length, 1);
  assert.equal(short[0].len, 5);
  assert.equal(short[0].line1Len, 5);

  const twoLines = layoutVrcBubbles("今天天气真不错，我们一起去VRChat玩吧！", lookup);
  assert.equal(twoLines.length, 1);
  assert.ok(twoLines[0].line1Len > 0 && twoLines[0].line1Len < twoLines[0].len);
  assert.ok(twoLines[0].len <= MAX_CHARS_PER_BUBBLE);

  // Compute actual em advance per line to verify neither line overflows
  const row0Adv = twoLines[0].glyphs
    .slice(0, twoLines[0].line1Len)
    .reduce((s, g) => s + g.advance, 0);
  const row1Adv = twoLines[0].glyphs
    .slice(twoLines[0].line1Len)
    .reduce((s, g) => s + g.advance, 0);
  assert.ok(row0Adv <= MAX_LINE_ADVANCE + 1e-6);
  assert.ok(row1Adv <= MAX_LINE_ADVANCE + 1e-6);
  // VRChat word should not be torn mid-word across lines
  const l0Text = Array.from(twoLines[0].text).slice(0, twoLines[0].line1Len).join("");
  const l1Text = Array.from(twoLines[0].text).slice(twoLines[0].line1Len).join("");
  assert.ok(l1Text.includes("VRChat") || l0Text.includes("VRChat"));

  // Kinsoku: line 2 should not start with a comma when pulled down cleanly
  const kinsoku = layoutVrcBubbles("一二三四五六七八九十十一，后面接着说", lookup);
  const kL1 = Array.from(kinsoku[0].text).slice(kinsoku[0].line1Len).join("");
  assert.ok(!kL1.startsWith("，"), `line 2 started with comma: ${kL1}`);

  // Long utterance > 24 chars splits into >= 2 bubbles with contiguous codepoint boundaries
  const longText = "一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥";
  const multi = layoutVrcBubbles(longText, lookup);
  assert.ok(multi.length >= 2);
  assert.ok(multi.every((b) => b.len <= MAX_CHARS_PER_BUBBLE));
  assert.equal(multi.map((b) => b.text).join(""), longText);
  assert.equal(multi[0].startCp, 0);
  assert.equal(multi[1].startCp, multi[0].endCp);

  // Narrow-char lines near 24-char limit + kinsoku punctuation never exceed MAX_CHARS_PER_BUBBLE
  const narrowStart = `${"i".repeat(24)}，后面`;
  const narrowStartChunks = layoutVrcBubbles(narrowStart, lookup);
  assert.ok(narrowStartChunks.every((b) => b.len <= MAX_CHARS_PER_BUBBLE));
  assert.equal(narrowStartChunks.map((b) => b.text).join(""), narrowStart);

  const narrowEnd = `${"i".repeat(23)}「ab`;
  const narrowEndChunks = layoutVrcBubbles(narrowEnd, lookup);
  assert.ok(narrowEndChunks.every((b) => b.len <= MAX_CHARS_PER_BUBBLE));
  assert.equal(narrowEndChunks.map((b) => b.text).join(""), narrowEnd);
  assert.ok(narrowEndChunks.length >= 2 && narrowEndChunks[1].text.startsWith("「ab"));
});

test("OSC packet encoder and VrcBubbleOscSender stream slices and clear cleanly over UDP", async () => {
  const pkt = encodeOscMessage("/avatar/parameters/EB_Test", [
    { type: "i", value: 42 },
    { type: "f", value: 0.5 },
    { type: "b", value: true },
    { type: "b", value: false },
  ]);
  const parsed = decodeOsc(pkt);
  assert.equal(parsed.address, "/avatar/parameters/EB_Test");
  assert.equal(parsed.tags, "ifTF");
  assert.equal(parsed.args[0], 42);
  assert.equal(parsed.args[1], 0.5);
  assert.equal(parsed.args[2], true);
  assert.equal(parsed.args[3], false);

  const server = dgram.createSocket("udp4");
  server.bind(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;
  const received: Array<{ address: string; args: Array<number | boolean> }> = [];
  server.on("message", (msg) => {
    const d = decodeOsc(msg);
    received.push({ address: d.address, args: d.args });
  });

  const senderErrors: Error[] = [];
  const sender = new VrcBubbleOscSender({
    port,
    sliceIntervalMs: 15,
    repairIntervalMs: 25,
    repairPasses: 0,
    clearResetMs: 60,
    onError: (err) => senderErrors.push(err),
  });
  const defaultSender = new VrcBubbleOscSender({ port });

  try {
    assert.ok(defaultSender.clearResetMs >= 350);
    defaultSender.close();

    const chunk = layoutVrcBubbles("你好世界再见", lookup)[0]; // 6 chars = 2 slices
    sender.showChunk(chunk);
    await new Promise((r) => setTimeout(r, 80));

    const slices = received
      .filter((m) => m.address === "/avatar/parameters/EB_Slice")
      .map((m) => m.args[0]);
    const gens = received
      .filter((m) => m.address === "/avatar/parameters/EB_Gen")
      .map((m) => m.args[0]);
    const seqs = received
      .filter((m) => m.address === "/avatar/parameters/EB_Seq")
      .map((m) => m.args[0]);

    assert.deepEqual(slices, [0, 1]);
    assert.deepEqual(gens, [1, 1]);
    assert.deepEqual(seqs, [1, 2]);

    received.length = 0;
    sender.clearAll();
    await new Promise((r) => setTimeout(r, 90));
    assert.ok(
      received.some(
        (m) => m.address === "/avatar/parameters/EB_Clear" && m.args[0] === true,
      ),
    );
    assert.ok(
      received.some(
        (m) => m.address === "/avatar/parameters/EB_Clear" && m.args[0] === false,
      ),
    );
    assert.ok(
      received.some(
        (m) => m.address === "/avatar/parameters/EB_Gen" && m.args[0] === 0,
      ),
    );

    (sender as unknown as { socket: dgram.Socket }).socket.emit(
      "error",
      new Error("mock-udp-err"),
    );
    assert.equal(senderErrors.length, 1);
    assert.equal(senderErrors[0].message, "mock-udp-err");
  } finally {
    defaultSender.close();
    sender.close();
    server.close();
  }
});

test("OutputRouter sends model chunks only in model mode and never hits Chatbox UDP", async () => {
  const chatSink = dgram.createSocket("udp4");
  chatSink.bind(0, "127.0.0.1");
  await once(chatSink, "listening");

  const oscSink = dgram.createSocket("udp4");
  oscSink.bind(0, "127.0.0.1");
  await once(oscSink, "listening");

  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const modelPort = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));

  let chatHits = 0;
  let oscHits = 0;
  chatSink.on("message", () => chatHits++);
  oscSink.on("message", () => oscHits++);

  const router = new OutputRouter({
    chat: (chatSink.address() as net.AddressInfo).port,
    model: modelPort,
    osc: (oscSink.address() as net.AddressInfo).port,
  });

  try {
    assert.throws(() => router.clearModel());
    await router.setMode("model");
    const chunk = layoutVrcBubbles("测试气泡", lookup)[0];
    router.sendModelChunk(chunk);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(chatHits, 0);
    assert.ok(oscHits > 0);
  } finally {
    await router.close();
    chatSink.close();
    oscSink.close();
  }
});
