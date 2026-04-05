import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { LLM_PROVIDER, LLM_MODEL, LLM_TEMPERATURE } from "./env";

const DEFAULTS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  ollama: "llama3.2",
};

async function createLlm(): Promise<BaseChatModel> {
  const model = LLM_MODEL ?? DEFAULTS[LLM_PROVIDER] ?? DEFAULTS.openai;
  const temperature = LLM_TEMPERATURE;

  switch (LLM_PROVIDER) {
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic({ modelName: model, temperature });
    }
    case "google": {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      return new ChatGoogleGenerativeAI({ model, temperature });
    }
    case "groq": {
      const { ChatGroq } = await import("@langchain/groq");
      return new ChatGroq({ model, temperature });
    }
    case "ollama": {
      const { ChatOllama } = await import("@langchain/ollama");
      return new ChatOllama({ model, temperature });
    }
    case "openai":
    default: {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({ modelName: model, temperature });
    }
  }
}

export const llm = await createLlm();
