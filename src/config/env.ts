import "dotenv/config";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required but not set in .env`);
  return value;
}

export const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");
export const LLM_MODEL = process.env.LLM_MODEL ?? "gpt-4o-mini";
export const LLM_TEMPERATURE = Number(process.env.LLM_TEMPERATURE ?? 0);
export const PORT = Number(process.env.PORT ?? 3000);
export const DATABASE_URL = process.env.DATABASE_URL;
export const MCP_SERVERS_PATH = process.env.MCP_SERVERS_PATH;
