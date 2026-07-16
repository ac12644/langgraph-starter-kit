import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

/**
 * A model that replays a scripted list of responses, letting tests walk
 * multi-agent flows (delegation, handoffs, tool calls) offline — no API key
 * or network. Agents sharing one instance consume the queue in call order.
 */
export class ScriptedToolCallingModel extends BaseChatModel {
  private queue: AIMessage[];

  constructor(queue: AIMessage[]) {
    super({});
    this.queue = [...queue];
  }

  _llmType(): string {
    return "scripted-tool-calling";
  }

  // createAgent binds tools to the model; ours is pre-scripted, so the
  // bound tools don't influence output — return the same instance.
  override bindTools(): this {
    return this;
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    const message = this.queue.shift();
    if (!message) throw new Error("Scripted model ran out of responses");
    return { generations: [{ message, text: "" }] };
  }
}
