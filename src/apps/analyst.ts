import { z } from "zod";
import { toolStrategy, providerStrategy } from "langchain";
import { LLM_PROVIDER, type LlmProvider } from "../config/env";
import { getLlm } from "../config/llm";
import { getCheckpointer } from "../config/checkpointer";
import { makeAgent } from "../agents/factory";

export const SummarySchema = z.object({
  title: z.string().describe("A short title for the summary"),
  keyPoints: z.array(z.string()).describe("Key points extracted"),
  sentiment: z.enum(["positive", "negative", "neutral"]).describe("Overall sentiment"),
});

// toolStrategy forces a tool call, which Groq's gpt-oss models don't
// reliably make (Groq rejects the plain-text reply with a 400). Use the
// provider's native structured output there; everything else keeps
// toolStrategy, which works across providers.
export function analystResponseFormat(provider: LlmProvider) {
  return provider === "groq"
    ? providerStrategy(SummarySchema)
    : toolStrategy(SummarySchema);
}

export async function createAnalystApp() {
  const llm = await getLlm();

  // A single agent — no supervisor layer needed. The structured result is
  // returned on the `structuredResponse` key of the final state.
  return makeAgent({
    name: "analyst",
    llm,
    tools: [],
    system:
      "You analyze text and produce structured summaries with key points and sentiment.",
    responseFormat: analystResponseFormat(LLM_PROVIDER),
    checkpointer: await getCheckpointer(),
  });
}
