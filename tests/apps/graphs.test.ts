import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Dummy key: tests never hit a real provider.
vi.stubEnv("OPENAI_API_KEY", "test");

// Scripted LLM: rag agent calls the retrieval tool once, then answers.
vi.mock("../../src/config/llm", async () => {
  const { AIMessage } = await import("@langchain/core/messages");
  const { ScriptedToolCallingModel } = await import("../helpers/scripted-model");
  return {
    getLlm: async () =>
      new ScriptedToolCallingModel([
        new AIMessage({
          content: "",
          tool_calls: [
            { id: "s1", name: "search_knowledge_base", args: { query: "langgraph" } },
          ],
        }),
        new AIMessage("done"),
      ]),
  };
});

// Embeddings stub: no network.
vi.mock("../../src/config/embeddings", () => ({
  createEmbeddings: async () => ({
    embedDocuments: async (texts: string[]) => texts.map(() => [1, 0, 0]),
    embedQuery: async () => [1, 0, 0],
  }),
}));

const { graphs } = JSON.parse(readFileSync("langgraph.json", "utf8")) as {
  graphs: Record<string, string>;
};

type GraphFactory = (config: unknown, runtime: unknown) => Promise<{
  invoke: (input: unknown, config?: unknown) => Promise<{ messages: { getType(): string; content: unknown }[] }>;
}>;

async function loadFactory(spec: string): Promise<GraphFactory> {
  // Same shape the LangGraph API loader uses: "<file>:<exportName>"
  const [file, exportName] = spec.split(":");
  const mod = await import(resolve(file));
  return mod[exportName] as GraphFactory;
}

describe("langgraph.json graph entries", () => {
  for (const [name, spec] of Object.entries(graphs)) {
    it(`${name} loads when called as factory(config, runtime)`, async () => {
      const factory = await loadFactory(spec);
      const graph = await factory({ configurable: {} }, {});
      expect(typeof graph.invoke).toBe("function");
    });
  }

  it("rag actually runs a retrieval search after loading", async () => {
    const factory = await loadFactory(graphs.rag);
    const graph = await factory({ configurable: {} }, {});

    const result = await graph.invoke(
      { messages: [{ role: "user", content: "what is langgraph?" }] },
      { configurable: { thread_id: "rag-graph-entry-test" } },
    );

    const toolMessage = result.messages.find((m) => m.getType() === "tool");
    expect(String(toolMessage?.content)).toContain("[1]");
  });
});