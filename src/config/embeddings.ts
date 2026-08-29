import type { Embeddings } from "@langchain/core/embeddings";
import {
  DEFAULT_EMBEDDINGS_PROVIDER,
  EMBEDDINGS_MODEL,
  EMBEDDINGS_PROVIDER_RAW,
  LLM_PROVIDER,
  VALID_EMBEDDINGS_PROVIDERS,
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

function resolveEmbeddingsProviderAtCall(): { provider: EmbeddingsProvider; explicit: boolean } {
  const explicit = Boolean(EMBEDDINGS_PROVIDER_RAW);
  if (!EMBEDDINGS_PROVIDER_RAW) {
    return { provider: DEFAULT_EMBEDDINGS_PROVIDER[LLM_PROVIDER], explicit: false };
  }

  const normalized = EMBEDDINGS_PROVIDER_RAW.toLowerCase();
  if (!VALID_EMBEDDINGS_PROVIDERS.includes(normalized as EmbeddingsProvider)) {
    throw new Error(
      `Invalid EMBEDDINGS_PROVIDER "${EMBEDDINGS_PROVIDER_RAW}". Must be one of: ${VALID_EMBEDDINGS_PROVIDERS.join(", ")}`
    );
  }

  return { provider: normalized as EmbeddingsProvider, explicit };
}

function assertEmbeddingsProviderKey(provider: EmbeddingsProvider): void {
  const requiredKey = EMBEDDINGS_API_KEYS[provider];
  if (requiredKey && !process.env[requiredKey]) {
    throw new Error(
      `${requiredKey} is required for embeddings provider "${provider}" but not set in .env`
    );
  }
}

let implicitFallbackLogged = false;

function maybeLogImplicitFallback(
  provider: EmbeddingsProvider,
  explicit: boolean,
  model: string
): void {
  if (
    implicitFallbackLogged ||
    explicit ||
    provider !== "openai" ||
    DEFAULT_EMBEDDINGS_PROVIDER[LLM_PROVIDER] === LLM_PROVIDER
  ) {
    return;
  }

  console.warn(
    `Embeddings: ${LLM_PROVIDER} has no embeddings API — falling back to OpenAI (${model}). ` +
      "Set EMBEDDINGS_PROVIDER to choose explicitly."
  );
  implicitFallbackLogged = true;
}

export async function createEmbeddings(modelOverride?: string): Promise<Embeddings> {
  const { provider, explicit } = resolveEmbeddingsProviderAtCall();

  const model = modelOverride ?? EMBEDDINGS_MODEL ?? DEFAULTS[provider];
  maybeLogImplicitFallback(provider, explicit, model);
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
