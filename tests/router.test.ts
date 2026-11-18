import { test } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import net from "node:net";
import { once } from "node:events";
import { OutputRouter } from "../src/output-router";
test("general mode rejects every text endpoint and cancels queued Chatbox output", async () => {
  const sink = dgram.createSocket("udp4");
  sink.bind(0, "127.0.0.1");
  await once(sink, "listening");
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const modelPort = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const router = new OutputRouter({
    chat: (sink.address() as any).port,
    model: modelPort,
  });
  let received = 0;
  sink.on("message", () => received++);
  try {
    assert.equal(router.modelUrl, "");
    assert.throws(() => router.send("private"));
    await assert.rejects(async () => router.clear());
    assert.throws(() => router.publish({ type: "begin", text: "private" }));
    router.cancel("none");
    await router.setMode("chatbox");
    const first = once(sink, "message");
    const sending = router.send("第一句。第二句。");
    await first;
    await router.setMode("general");
    await sending;
    const count = received;
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(received, count);
    assert.equal(count, 1);
    await router.setMode("model");
    assert.ok(router.modelUrl.includes("token="));
    await router.setMode("general");
    const server = net.createServer();
    server.listen(modelPort, "127.0.0.1");
    await once(server, "listening");
    await new Promise<void>((r) => server.close(() => r()));
  } finally {
    await router.close();
    sink.close();
  }
});
