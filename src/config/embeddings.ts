import type { Embeddings } from "@langchain/core/embeddings";
import { LLM_PROVIDER } from "./env";

const DEFAULTS: Record<string, string> = {
  openai: "text-embedding-3-small",
  anthropic: "text-embedding-3-small", // Anthropic doesn't have embeddings; fallback to OpenAI
  google: "text-embedding-004",
  groq: "text-embedding-3-small", // Groq doesn't have embeddings; fallback to OpenAI
  ollama: "nomic-embed-text",
};

export async function createEmbeddings(modelOverride?: string): Promise<Embeddings> {
  const provider = LLM_PROVIDER;
  const model = modelOverride ?? DEFAULTS[provider] ?? DEFAULTS.openai;

  switch (provider) {
    case "google": {
      const { GoogleGenerativeAIEmbeddings } = await import("@langchain/google-genai");
      return new GoogleGenerativeAIEmbeddings({ model });
    }
    case "ollama": {
      const { OllamaEmbeddings } = await import("@langchain/ollama");
      return new OllamaEmbeddings({ model });
    }
    default: {
      // OpenAI embeddings as default (also used by anthropic/groq which lack embeddings)
      const { OpenAIEmbeddings } = await import("@langchain/openai");
      return new OpenAIEmbeddings({ model });
    }
  }
}
