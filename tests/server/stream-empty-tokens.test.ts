import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { MemorySaver } from "@langchain/langgraph";
import { makeAgent } from "../../src/agents/factory";
import { asApp, buildServer } from "../../src/server/app";

/**
 * Reasoning models (e.g. gpt-oss on Groq) stream chunks that carry no text.
 * /stream must not forward those as empty `token` events.
 */
class ReasoningThenTextModel extends BaseChatModel {
  _llmType(): string {
    return "reasoning-then-text";
  }

  override bindTools(): this {
    return this;
  }

  async _generate(): Promise<ChatResult> {
    return { generations: [{ message: new AIMessage("Hi there"), text: "Hi there" }] };
  }

  override async *_streamResponseChunks(
    _messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    // Two empty chunks (reasoning), then the visible text.
    for (const text of ["", "", "Hi", " there"]) {
      const chunk = new ChatGenerationChunk({
        message: new AIMessageChunk({ content: text }),
        text,
      });
      yield chunk;
      await runManager?.handleLLMNewToken(text, undefined, undefined, undefined, undefined, {
        chunk,
      });
    }
  }
}

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("POST /:app/stream tokens", () => {
  it("does not emit empty token events for chunks without text", async () => {
    const agent = makeAgent({
      name: "chat",
      llm: new ReasoningThenTextModel({}),
      tools: [],
      checkpointer: new MemorySaver(),
    });
    const server = buildServer({ chat: asApp(agent) });
    servers.push(server);
    const url = await server.listen({ port: 0, host: "127.0.0.1" });

    const res = await fetch(`${url}/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hi" }],
        thread_id: "empty-token-test",
      }),
    });
    const body = await res.text();

    const events = body
      .split("\n\n")
      .filter((block) => block.startsWith("data: "))
      .map((block) => JSON.parse(block.slice("data: ".length)));
    const tokens = events.filter((e) => e.type === "token");

    // Control: the visible text did stream.
    expect(tokens.map((t) => t.content).join("")).toBe("Hi there");
    // The point: no empty token events.
    expect(tokens.every((t) => t.content !== "")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  }, 15_000);
});