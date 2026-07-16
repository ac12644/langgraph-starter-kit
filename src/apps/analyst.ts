import { z } from "zod";
import { toolStrategy } from "langchain";
import { getLlm } from "../config/llm";
import { getCheckpointer } from "../config/checkpointer";
import { makeAgent } from "../agents/factory";

export const SummarySchema = z.object({
  title: z.string().describe("A short title for the summary"),
  keyPoints: z.array(z.string()).describe("Key points extracted"),
  sentiment: z.enum(["positive", "negative", "neutral"]).describe("Overall sentiment"),
});

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
    // toolStrategy works with every provider; models with native structured
    // output support could use providerStrategy instead.
    responseFormat: toolStrategy(SummarySchema),
    checkpointer: await getCheckpointer(),
  });
}
