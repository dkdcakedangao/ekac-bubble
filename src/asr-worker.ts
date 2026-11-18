import { Asr } from "./asr";
const port = (process as any).parentPort;
let asr: Asr;
port.on("message", async ({ data }: any) => {
  try {
    let value: any;
    if (data.kind === "load") {
      asr = new Asr(data.dir, (status) => port.postMessage({ status }));
      await asr.load();
      value = true;
    } else if (data.kind === "decode") {
      if (!asr) throw Error("识别器未加载");
      value = await asr.decode(new Int16Array(data.pcm));
    } else throw Error("未知识别请求");
    port.postMessage({ id: data.id, value });
  } catch (error) {
    port.postMessage({ id: data.id, error: (error as Error).message });
  }
});
