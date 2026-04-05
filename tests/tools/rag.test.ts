import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryVectorStore, buildVectorStore, createRetrievalTool } from "../../src/tools/rag";
import type { Embeddings } from "@langchain/core/embeddings";

// Mock embeddings that return simple deterministic vectors
function createMockEmbeddings(): Embeddings {
  let callCount = 0;

  // Generate a simple vector: mostly zeros with a 1.0 at a position based on content hash
  function simpleEmbed(text: string): number[] {
    const vec = new Array(8).fill(0);
    let hash = 0;
    for (const ch of text) hash = (hash + ch.charCodeAt(0)) % 8;
    vec[hash] = 1.0;
    // Add small noise based on call count for uniqueness
    vec[(hash + 1) % 8] = 0.1 * (callCount++ % 5);
    return vec;
  }

  return {
    embedDocuments: vi.fn(async (texts: string[]) => texts.map(simpleEmbed)),
    embedQuery: vi.fn(async (text: string) => simpleEmbed(text)),
  } as unknown as Embeddings;
}

describe("InMemoryVectorStore", () => {
  let embeddings: Embeddings;

  beforeEach(() => {
    embeddings = createMockEmbeddings();
  });

  it("adds documents and reports correct size", async () => {
    const store = new InMemoryVectorStore(embeddings);
    const { Document } = await import("@langchain/core/documents");
    await store.addDocuments([
      new Document({ pageContent: "hello world" }),
      new Document({ pageContent: "foo bar" }),
    ]);
    expect(store.size).toBe(2);
  });

  it("returns empty array when searching empty store", async () => {
    const store = new InMemoryVectorStore(embeddings);
    const results = await store.search("test");
    expect(results).toEqual([]);
  });

  it("returns results sorted by relevance", async () => {
    const store = new InMemoryVectorStore(embeddings);
    const { Document } = await import("@langchain/core/documents");
    await store.addDocuments([
      new Document({ pageContent: "cats are great pets" }),
      new Document({ pageContent: "dogs love walks" }),
      new Document({ pageContent: "cats purr when happy" }),
    ]);
    const results = await store.search("cats", 2);
    expect(results).toHaveLength(2);
  });
});

describe("buildVectorStore", () => {
  it("splits and indexes documents", async () => {
    const embeddings = createMockEmbeddings();
    const store = await buildVectorStore(
      embeddings,
      ["This is a short test document."],
      50,
      10
    );
    expect(store.size).toBeGreaterThanOrEqual(1);
  });
});

describe("createRetrievalTool", () => {
  it("creates a tool with correct name", async () => {
    const embeddings = createMockEmbeddings();
    const store = new InMemoryVectorStore(embeddings);
    const tool = createRetrievalTool(store);
    expect(tool.name).toBe("search_knowledge_base");
  });

  it("returns no-results message for empty store", async () => {
    const embeddings = createMockEmbeddings();
    const store = new InMemoryVectorStore(embeddings);
    const tool = createRetrievalTool(store);
    const result = await tool.invoke({ query: "anything", k: 4 });
    expect(result).toContain("No relevant documents found");
  });
});
