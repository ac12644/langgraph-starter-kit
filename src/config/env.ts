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

export const LLM_PROVIDER = resolveProvider();

// Validate API key exists for the selected provider
const requiredKey = API_KEY_MAP[LLM_PROVIDER];
if (requiredKey && !process.env[requiredKey]) {
  throw new Error(
    `${requiredKey} is required for provider "${LLM_PROVIDER}" but not set in .env`
  );
}

export const LLM_MODEL = process.env.LLM_MODEL || undefined;
export const LLM_TEMPERATURE = Number(process.env.LLM_TEMPERATURE ?? 0);
export const PORT = Number(process.env.PORT ?? 3000);
export const DATABASE_URL = process.env.DATABASE_URL;
export const MCP_SERVERS_PATH = process.env.MCP_SERVERS_PATH;
