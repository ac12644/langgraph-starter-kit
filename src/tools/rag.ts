import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Embeddings } from "@langchain/core/embeddings";

// Simple in-memory vector store — no external DB required
interface StoredChunk {
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class InMemoryVectorStore {
  private chunks: StoredChunk[] = [];
  private embeddings: Embeddings;

  constructor(embeddings: Embeddings) {
    this.embeddings = embeddings;
  }

  async addDocuments(docs: Document[]): Promise<void> {
    const texts = docs.map((d) => d.pageContent);
    const vectors = await this.embeddings.embedDocuments(texts);
    for (let i = 0; i < docs.length; i++) {
      this.chunks.push({
        content: texts[i],
        embedding: vectors[i],
        metadata: docs[i].metadata,
      });
    }
  }

  async search(query: string, k = 4): Promise<string[]> {
    if (this.chunks.length === 0) return [];
    const queryVec = await this.embeddings.embedQuery(query);
    const scored = this.chunks
      .map((chunk) => ({
        content: chunk.content,
        score: cosineSimilarity(queryVec, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    return scored.map((s) => s.content);
  }

  get size(): number {
    return this.chunks.length;
  }
}

// -- RAG Pipeline --

export async function buildVectorStore(
  embeddings: Embeddings,
  documents: string[],
  chunkSize = 500,
  chunkOverlap = 100,
): Promise<InMemoryVectorStore> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });

  const docs: Document[] = [];
  for (const text of documents) {
    const chunks = await splitter.createDocuments([text]);
    docs.push(...chunks);
  }

  const store = new InMemoryVectorStore(embeddings);
  await store.addDocuments(docs);
  return store;
}

// -- Tool Factory --

export function createRetrievalTool(vectorStore: InMemoryVectorStore) {
  return tool(
    async ({ query, k }) => {
      const results = await vectorStore.search(query, k);
      if (results.length === 0) {
        return "No relevant documents found. Try rephrasing your query.";
      }
      return results
        .map((r, i) => `[${i + 1}] ${r}`)
        .join("\n\n");
    },
    {
      name: "search_knowledge_base",
      description:
        "Search the knowledge base for relevant information. Use this to find context before answering questions.",
      schema: z.object({
        query: z.string().describe("The search query"),
        k: z.number().optional().default(4).describe("Number of results to return"),
      }),
    }
  );
}

// -- Sample Documents --

export const SAMPLE_DOCS = [
  `LangGraph is a framework for building stateful, multi-actor applications with LLMs.
It extends LangChain with the ability to coordinate multiple agents, manage complex
state, and implement human-in-the-loop workflows. LangGraph uses a graph-based
architecture where nodes represent computational steps and edges define the flow
between them. Key features include persistence (checkpointing), streaming support,
and the ability to create both simple chains and complex multi-agent systems.`,

  `The supervisor pattern in multi-agent systems uses a central coordinator (the supervisor)
to route tasks to specialized worker agents. The supervisor decides which agent should
handle each part of a task based on the agent's capabilities. This pattern is useful
when tasks require different types of expertise — for example, a math agent and a
writing agent working together. The supervisor can also aggregate results from multiple
agents before returning a final answer to the user.`,

  `Retrieval-Augmented Generation (RAG) is a technique that enhances LLM responses by
first retrieving relevant documents from a knowledge base, then providing those
documents as context to the LLM. RAG helps reduce hallucinations and allows the model
to answer questions about specific, private, or up-to-date information that wasn't in
its training data. A typical RAG pipeline involves: document loading, text splitting
(chunking), embedding generation, vector storage, similarity search at query time,
and context-augmented generation.`,

  `The swarm pattern allows multiple agents to collaborate without a central coordinator.
Each agent can hand off tasks to other agents using transfer tools. The active agent
processes messages until it either completes the task or transfers control to another
agent. This creates a decentralized, flexible system where agents self-organize based
on the task requirements. Swarms are particularly useful for open-ended conversations
where the appropriate agent depends on the evolving context.`,

  `Human-in-the-loop (HITL) workflows pause agent execution at critical points to get
human approval before proceeding. This is essential for high-stakes operations like
deleting data, sending emails, or making financial transactions. In LangGraph, HITL
is implemented using the interrupt() function, which pauses the graph and stores its
state. The graph can be resumed later with a Command containing the human's decision.
This pattern ensures that dangerous or irreversible actions always have human oversight.`,

  `Model Context Protocol (MCP) is an open standard that allows LLM applications to
connect to external tools and data sources through a unified interface. MCP servers
expose tools that agents can discover and use at runtime. This means you can extend
your agent's capabilities without modifying its code — just connect a new MCP server.
MCP supports both stdio transport (for local tools) and HTTP transport (for remote
services). LangChain provides the @langchain/mcp-adapters library for easy integration.`,
];
