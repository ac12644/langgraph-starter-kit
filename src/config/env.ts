import "dotenv/config";

const VALID_PROVIDERS = ["openai", "anthropic", "google", "groq", "ollama"] as const;
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

export const LLM_PROVIDER = resolveProvider();

// Fail fast: validate the default provider's key at startup.
assertProviderKey(LLM_PROVIDER);

export const LLM_MODEL = process.env.LLM_MODEL || undefined;
export const LLM_TEMPERATURE = Number(process.env.LLM_TEMPERATURE ?? 0);
export const PORT = Number(process.env.PORT ?? 3000);
export const DATABASE_URL = process.env.DATABASE_URL;
export const MCP_SERVERS_PATH = process.env.MCP_SERVERS_PATH;
