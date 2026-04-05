import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { LLM_PROVIDER, LLM_MODEL, LLM_TEMPERATURE } from "./env";

const DEFAULTS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  ollama: "llama3.2",
};

function createLlm(): BaseChatModel {
  const model = LLM_MODEL ?? DEFAULTS[LLM_PROVIDER] ?? DEFAULTS.openai;
  const temperature = LLM_TEMPERATURE;

  switch (LLM_PROVIDER) {
    case "anthropic": {
      const { ChatAnthropic } = require("@langchain/anthropic");
      return new ChatAnthropic({ modelName: model, temperature });
    }
    case "google": {
      const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
      return new ChatGoogleGenerativeAI({ modelName: model, temperature });
    }
    case "groq": {
      const { ChatGroq } = require("@langchain/groq");
      return new ChatGroq({ modelName: model, temperature });
    }
    case "ollama": {
      const { ChatOllama } = require("@langchain/ollama");
      return new ChatOllama({ model, temperature });
    }
    case "openai":
    default: {
      const { ChatOpenAI } = require("@langchain/openai");
      return new ChatOpenAI({ modelName: model, temperature });
    }
  }
}

export const llm = createLlm();
