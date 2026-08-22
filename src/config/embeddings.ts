import type { Embeddings } from "@langchain/core/embeddings";
import {
  EMBEDDINGS_MODEL,
  EMBEDDINGS_PROVIDER,
  EMBEDDINGS_PROVIDER_EXPLICIT,
  LLM_PROVIDER,
  LLM_PROVIDERS_WITHOUT_EMBEDDINGS,
  type EmbeddingsProvider,
} from "./env";

const DEFAULTS: Record<EmbeddingsProvider, string> = {
  openai: "text-embedding-3-small",
  google: "text-embedding-004",
  ollama: "nomic-embed-text",
};

// Providers with a native embeddings API (and their required env keys).
const EMBEDDINGS_API_KEYS: Record<EmbeddingsProvider, string> = {
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  ollama: "",
};

function assertEmbeddingsProviderKey(provider: EmbeddingsProvider): void {
  const requiredKey = EMBEDDINGS_API_KEYS[provider];
  if (requiredKey && !process.env[requiredKey]) {
    throw new Error(
      `${requiredKey} is required for embeddings provider "${provider}" but not set in .env`
    );
  }
}

let implicitFallbackLogged = false;

function maybeLogImplicitFallback(model: string): void {
  // Log once when an implicit OpenAI fallback engages; skip if already logged
  // or if the user set EMBEDDINGS_PROVIDER explicitly.
  if (
    implicitFallbackLogged ||
    EMBEDDINGS_PROVIDER_EXPLICIT ||
    !LLM_PROVIDERS_WITHOUT_EMBEDDINGS.has(LLM_PROVIDER) ||
    EMBEDDINGS_PROVIDER !== "openai"
  ) {
    return;
  }
  console.warn(
    `Embeddings: ${LLM_PROVIDER} has no embeddings API — falling back to OpenAI (${model}). ` +
      `Set EMBEDDINGS_PROVIDER to choose explicitly.`
  );
  implicitFallbackLogged = true;
}

export async function createEmbeddings(modelOverride?: string): Promise<Embeddings> {
  const provider = EMBEDDINGS_PROVIDER;

  const model = modelOverride ?? EMBEDDINGS_MODEL ?? DEFAULTS[provider];
  maybeLogImplicitFallback(model);
  assertEmbeddingsProviderKey(provider);

  switch (provider) {
    case "google": {
      const { GoogleGenerativeAIEmbeddings } = await import("@langchain/google-genai");
      return new GoogleGenerativeAIEmbeddings({ model });
    }
    case "ollama": {
      const { OllamaEmbeddings } = await import("@langchain/ollama");
      return new OllamaEmbeddings({ model });
    }
    case "openai": {
      const { OpenAIEmbeddings } = await import("@langchain/openai");
      return new OpenAIEmbeddings({ model });
    }
  }
}
