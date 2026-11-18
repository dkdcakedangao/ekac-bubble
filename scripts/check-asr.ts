import { Asr } from "../src/asr";
import { readFileSync } from "node:fs";
const asr = new Asr(process.argv[2], console.log);
await asr.load();
const wav = readFileSync(process.argv[3]);
let i = 12,
  rate = 0,
  channels = 0,
  bits = 0,
  audio: Buffer | undefined;
while (i + 8 <= wav.length) {
  const id = wav.toString("ascii", i, i + 4),
    len = wav.readUInt32LE(i + 4);
  if (id === "fmt ") {
    channels = wav.readUInt16LE(i + 10);
    rate = wav.readUInt32LE(i + 12);
    bits = wav.readUInt16LE(i + 22);
  }
  if (id === "data") {
    audio = wav.subarray(i + 8, i + 8 + len);
    break;
  }
  i += 8 + len + (len % 2);
}
if (rate !== 16000 || bits !== 16 || channels !== 1 || !audio)
  throw Error(`Need PCM16 mono 16k: ${rate}/${bits}/${channels}`);
const pcm = new Int16Array(
  audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
);
const text = await asr.decode(pcm);
if (!text) throw Error("Empty real recognition");
console.log("ASR_REAL_PASS", text);
const silent = await asr.decode(new Int16Array(32000));
console.log("SILENCE", JSON.stringify(silent));
