import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  LLM_PROVIDER,
  LLM_MODEL,
  LLM_TEMPERATURE,
  assertProviderKey,
  type LlmProvider,
} from "./env";

const DEFAULTS: Record<LlmProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  ollama: "llama3.2",
};

export interface LlmOptions {
  /** Override the env-configured provider. */
  provider?: LlmProvider;
  /** Override the model name. */
  model?: string;
  /** Override the sampling temperature. */
  temperature?: number;
}

async function createLlm(opts: LlmOptions = {}): Promise<BaseChatModel> {
  const provider = opts.provider ?? LLM_PROVIDER;
  assertProviderKey(provider);

  const model = opts.model ?? LLM_MODEL ?? DEFAULTS[provider];
  const temperature = opts.temperature ?? LLM_TEMPERATURE;

  switch (provider) {
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

let _default: Promise<BaseChatModel> | undefined;

/**
 * Returns a chat model.
 *
 * Called with no options it returns a memoized, shared instance built from the
 * env-configured provider — so every agent reuses one model by default and
 * nothing is constructed until first use (no import-time side effects).
 *
 * Pass options to build a distinct model, e.g. a cheap model for routing and a
 * stronger one for reasoning:
 *
 *   const router = await getLlm({ model: "gpt-4o-mini" });
 *   const worker = await getLlm({ model: "gpt-4o" });
 */
export function getLlm(opts?: LlmOptions): Promise<BaseChatModel> {
  if (!opts || Object.keys(opts).length === 0) {
    _default ??= createLlm();
    return _default;
  }
  return createLlm(opts);
}
