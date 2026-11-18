import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySentenceSuffix,
  normalizeSuffixText,
  MAX_SUFFIX_LENGTH,
} from "../src/sentence-suffix";

test("inserts suffix before trailing Chinese and English sentence punctuation", () => {
  assert.equal(applySentenceSuffix("你好呀！", true, "喵"), "你好呀喵！");
  assert.equal(applySentenceSuffix("你在干嘛？", true, "喵"), "你在干嘛喵？");
  assert.equal(applySentenceSuffix("今天天气真好。", true, "喵"), "今天天气真好喵。");
  assert.equal(applySentenceSuffix("Hello!", true, "喵"), "Hello喵!");
  assert.equal(applySentenceSuffix("早上好", true, "喵"), "早上好喵");
});

test("merges suffix punctuation cleanly without redundant periods or duplicate marks", () => {
  assert.equal(
    applySentenceSuffix("今天天气真好。", true, "喵～"),
    "今天天气真好喵～",
  );
  assert.equal(
    applySentenceSuffix("今天天气真好.", true, "喵～"),
    "今天天气真好喵～",
  );
  assert.equal(
    applySentenceSuffix("好开心～", true, "喵～"),
    "好开心喵～",
  );
  assert.equal(
    applySentenceSuffix("你好呀！", true, "喵！"),
    "你好呀喵！",
  );
  assert.equal(
    applySentenceSuffix("你在干嘛？", true, "喵～"),
    "你在干嘛喵～？",
  );
});

test("deduplicates when spoken sentence already ends with suffix", () => {
  assert.equal(applySentenceSuffix("早上好喵", true, "喵"), "早上好喵");
  assert.equal(applySentenceSuffix("早上好喵！", true, "喵"), "早上好喵！");
  assert.equal(applySentenceSuffix("早上好喵。", true, "喵～"), "早上好喵～");
});

test("applies suffix per sentence across multi-sentence and multi-line inputs while preserving decimals and mid-sentence pauses", () => {
  assert.equal(
    applySentenceSuffix("你好呀！一起去拍照吗？", true, "喵"),
    "你好呀喵！一起去拍照吗喵？",
  );
  assert.equal(
    applySentenceSuffix("第一句\n第二句！", true, "喵"),
    "第一句喵\n第二句喵！",
  );
  assert.equal(
    applySentenceSuffix("当前版本 0.3.0。", true, "喵"),
    "当前版本 0.3.0喵。",
  );
  assert.equal(
    applySentenceSuffix("圆周率约等于 3.14！", true, "喵"),
    "圆周率约等于 3.14喵！",
  );
  assert.equal(
    applySentenceSuffix("嗯……我想想。", true, "喵"),
    "嗯……我想想喵。",
  );
  assert.equal(
    applySentenceSuffix("嗯……", true, "喵"),
    "嗯喵……",
  );
  assert.equal(
    applySentenceSuffix("呐～今天去哪玩？", true, "喵"),
    "呐～今天去哪玩喵？",
  );
  assert.equal(
    applySentenceSuffix("今天去VRChat（测试服）。", true, "喵"),
    "今天去VRChat（测试服）喵。",
  );
  assert.equal(
    applySentenceSuffix("「早上好！」", true, "喵"),
    "「早上好喵！」",
  );
});

test("respects disabled flag, blank suffix, pure punctuation, and normalization limits", () => {
  assert.equal(applySentenceSuffix("你好呀！", false, "喵"), "你好呀！");
  assert.equal(applySentenceSuffix("你好呀！", true, "   "), "你好呀！");
  assert.equal(applySentenceSuffix("   ", true, "喵"), "");
  assert.equal(applySentenceSuffix("？？？", true, "喵"), "？？？");
  assert.equal(
    normalizeSuffixText("喵\r\n汪\t12345678901234567890").length <= MAX_SUFFIX_LENGTH,
    true,
  );
});
