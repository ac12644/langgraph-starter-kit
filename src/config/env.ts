import "dotenv/config";

const VALID_PROVIDERS = ["openai", "anthropic", "google", "groq", "ollama", "deepseek"] as const;
export type LlmProvider = (typeof VALID_PROVIDERS)[number];

function resolveProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER || "openai").toLowerCase();
  if (!VALID_PROVIDERS.includes(raw as LlmProvider)) {
    throw new Error(
      `Invalid LLM_PROVIDER "${raw}". Must be one of: ${VALID_PROVIDERS.join(", ")}`
    );
  }
  return raw as LlmProvider;
}

const API_KEY_MAP: Record<LlmProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  groq: "GROQ_API_KEY",
  ollama: "", // no key needed
  deepseek: "DEEPSEEK_API_KEY",
};

/**
 * Throws if the API key required by `provider` is not set.
 * Reused by the LLM factory so per-agent provider overrides are
 * validated the same way as the default provider.
 */
export function assertProviderKey(provider: LlmProvider): void {
  const requiredKey = API_KEY_MAP[provider];
  if (requiredKey && !process.env[requiredKey]) {
    throw new Error(
      `${requiredKey} is required for provider "${provider}" but not set in .env`
    );
  }
}

const VALID_EMBEDDINGS_PROVIDERS = ["openai", "google", "ollama"] as const;
export type EmbeddingsProvider = (typeof VALID_EMBEDDINGS_PROVIDERS)[number];


const DEFAULT_EMBEDDINGS_PROVIDER: Record<LlmProvider, EmbeddingsProvider> = {
  openai: "openai",
  anthropic: "openai", // Anthropic has no native embeddings API; fall back to OpenAI
  google: "google",
  groq: "openai",
  ollama: "ollama",
  deepseek: "openai",
};

/** Chat providers with no native embeddings API — implicit default falls back to OpenAI. */
export const LLM_PROVIDERS_WITHOUT_EMBEDDINGS: ReadonlySet<LlmProvider> = new Set([
  "anthropic",
  "groq",
  "deepseek",
]);

function resolveEmbeddingsProvider(llmProvider: LlmProvider): EmbeddingsProvider {
  // step 1: Check environment variables(Prioritize explicitly configured by the user)
  const explicit = process.env.EMBEDDINGS_PROVIDER?.trim().toLowerCase();
  // step 2: If no, default mapping
  if (!explicit) {
    return DEFAULT_EMBEDDINGS_PROVIDER[llmProvider];
  }
  // step 3: After setting the environment variables, verify the legality first.
  if (!VALID_EMBEDDINGS_PROVIDERS.includes(explicit as EmbeddingsProvider)) {
    throw new Error(
      `Invalid EMBEDDINGS_PROVIDER "${explicit}". Must be one of: ${VALID_EMBEDDINGS_PROVIDERS.join(", ")}`
    );
  }
  // step 4: return value
  return explicit as EmbeddingsProvider;
}

export const LLM_PROVIDER = resolveProvider();

// Fail fast: validate the default provider's key at startup.
assertProviderKey(LLM_PROVIDER);

export const EMBEDDINGS_PROVIDER = resolveEmbeddingsProvider(LLM_PROVIDER);
export const EMBEDDINGS_MODEL = process.env.EMBEDDINGS_MODEL || undefined;
export const EMBEDDINGS_PROVIDER_EXPLICIT = Boolean(process.env.EMBEDDINGS_PROVIDER?.trim());

export const LLM_MODEL = process.env.LLM_MODEL || undefined;
export const LLM_TEMPERATURE = Number(process.env.LLM_TEMPERATURE ?? 0);
// `||` not `??`: an empty DEEPSEEK_THINKING= in .env must fall back to
// "disabled" rather than sending an invalid thinking type to the API.
export const DEEPSEEK_THINKING = process.env.DEEPSEEK_THINKING || "disabled";
export const PORT = Number(process.env.PORT ?? 3000);
export const DATABASE_URL = process.env.DATABASE_URL;
export const MCP_SERVERS_PATH = process.env.MCP_SERVERS_PATH;
