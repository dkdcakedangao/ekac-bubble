import { Chatbox, ModelPort } from "./transport";
import { VrcBubbleOscSender } from "./vrc-osc-sender";
import type { BubbleChunk } from "./vrc-bubble-layout";
export type OutputMode = "general" | "chatbox" | "model";
export class OutputRouter {
  constructor(private ports: { chat: number; model: number; osc?: number } = { chat: 9000, model: 9011, osc: 9000 }) {}
  mode: OutputMode | null = "general";
  private chat?: Chatbox;
  private model?: ModelPort;
  private vrcOsc?: VrcBubbleOscSender;
  private changing = Promise.resolve();
  get modelUrl() {
    return this.model
      ? `ws://127.0.0.1:${this.ports.model}/?token=${this.model.token}`
      : "";
  }
  setMode(mode: OutputMode) {
    const next = this.changing.then(async () => {
      if (this.mode === mode) return;
      this.mode = null;
      if (this.chat) {
        await this.chat.stop();
        this.chat = undefined;
      }
      if (this.vrcOsc) {
        this.vrcOsc.close();
        this.vrcOsc = undefined;
      }
      if (this.model) {
        await this.model.close();
        this.model = undefined;
      }
      if (mode === "chatbox")
        this.chat = new Chatbox("127.0.0.1", this.ports.chat);
      if (mode === "model") {
        const model = new ModelPort();
        const vrcOsc = new VrcBubbleOscSender({
          port: this.ports.osc ?? 9000,
          onError: (err) => console.error("[OutputRouter][vrc-osc]", err.message),
        });
        try {
          await model.start(this.ports.model);
          this.model = model;
          this.vrcOsc = vrcOsc;
        } catch (error) {
          vrcOsc.close();
          await model.close();
          this.mode = "general";
          throw error;
        }
      }
      this.mode = mode;
    });
    this.changing = next.catch(() => {});
    return next;
  }
  send(text: string) {
    if (this.mode !== "chatbox" || !this.chat)
      throw Error("当前模式不允许发送 Chatbox");
    return this.chat.send(text);
  }
  clear() {
    if (this.mode !== "chatbox" || !this.chat)
      throw Error("当前模式不允许清除 Chatbox");
    return this.chat.clear();
  }
  publish(event: any) {
    if (this.mode !== "model" || !this.model)
      throw Error("当前模式不允许发送模型消息");
    this.model.publish(event);
  }
  sendModelChunk(chunk: BubbleChunk) {
    if (this.mode !== "model" || !this.vrcOsc)
      throw Error("当前模式不允许发送模型 OSC 气泡");
    this.vrcOsc.showChunk(chunk);
  }
  clearModel() {
    if (this.mode !== "model" || !this.vrcOsc)
      throw Error("当前模式不允许清除模型气泡");
    this.vrcOsc.clearAll();
  }
  cancel(id: string) {
    this.chat?.cancel();
    this.vrcOsc?.clearAll();
    this.model?.publish({ type: "cancel", id });
  }
  async close() {
    await this.setMode("general");
  }
}
