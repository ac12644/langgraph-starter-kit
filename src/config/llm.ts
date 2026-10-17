import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  LLM_PROVIDER,
  LLM_MODEL,
  LLM_TEMPERATURE,
  DEEPSEEK_THINKING,
  assertProviderKey,
  type LlmProvider,
} from "./env";

const DEFAULTS: Record<LlmProvider, string> = {
  openai: "gpt-6-luna",
  anthropic: "claude-sonnet-5-5",
  google: "gemini-3.6-flash",
  groq: "openai/gpt-oss-120b",
  ollama: "llama3.2",
  deepseek: "deepseek-v4-flash",
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
  // GPT-6 and Claude 4.7+ reject non-default temperatures, so OpenAI and
  // Anthropic only get one when it was set explicitly.
  const temperature =
    opts.temperature ??
    LLM_TEMPERATURE ??
    (provider === "openai" || provider === "anthropic" ? undefined : 0);

  switch (provider) {
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic({ model, temperature });
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
    case "deepseek": {
      const { ChatDeepSeek } = await import("@langchain/deepseek");
      return new ChatDeepSeek({
        model,
        temperature,
        modelKwargs: { thinking: { type: DEEPSEEK_THINKING } },
      });
    }
    case "openai":
    default: {
      const { ChatOpenAI } = await import("@langchain/openai");
      // GPT-6 models only take function tools over the Responses API.
      return new ChatOpenAI({ model, temperature, useResponsesApi: true });
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
