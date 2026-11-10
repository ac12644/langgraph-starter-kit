import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderStrategy } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";

// Dummy key: tests never hit a real provider.
vi.stubEnv("OPENAI_API_KEY", "test");

const { analystResponseFormat, SummarySchema } = await import("../../src/apps/analyst");
const { makeAgent } = await import("../../src/agents/factory");

afterEach(() => vi.unstubAllGlobals());

describe("analyst responseFormat", () => {
  it("uses native structured output on groq and anthropic", () => {
    expect(analystResponseFormat("groq")).toBeInstanceOf(ProviderStrategy);
    expect(analystResponseFormat("anthropic")).toBeInstanceOf(ProviderStrategy);
  });

  it("keeps toolStrategy for other providers", () => {
    for (const p of ["openai", "google", "ollama", "deepseek"] as const) {
      expect(analystResponseFormat(p)).not.toBeInstanceOf(ProviderStrategy);
    }
  });

  // Claude Sonnet 5.5 returns a 400 for tool_choice "any"/"tool", which is
  // what toolStrategy sends. Check the request that actually goes out.
  it("does not force a tool call on anthropic", async () => {
    const bodies: Record<string, any>[] = [];
    const summary = { title: "t", keyPoints: ["k"], sentiment: "positive" };
    vi.stubGlobal("fetch", async (_url: unknown, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: [{ type: "text", text: JSON.stringify(summary) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const agent = makeAgent({
      name: "analyst",
      llm: new ChatAnthropic({ model: "claude-sonnet-5-5", apiKey: "test" }),
      responseFormat: analystResponseFormat("anthropic"),
    });
    const result = await agent.invoke({ messages: [{ role: "user", content: "sales up 10%" }] });

    expect(bodies).toHaveLength(1);
    expect(["any", "tool"]).not.toContain(bodies[0].tool_choice?.type);
    expect(bodies[0].temperature).toBeUndefined();
    expect(bodies[0].output_config?.format?.type).toBe("json_schema");
    expect(SummarySchema.parse((result as { structuredResponse?: unknown }).structuredResponse)).toEqual(summary);
  });
});
