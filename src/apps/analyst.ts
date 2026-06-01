import { z } from "zod";
import { getLlm } from "../config/llm";
import { echo } from "../tools/local";
import { makeAgent } from "../agents/factory";
import { makeSupervisor } from "../agents/supervisor";

export const SummarySchema = z.object({
  title: z.string().describe("A short title for the summary"),
  keyPoints: z.array(z.string()).describe("Key points extracted"),
  sentiment: z.enum(["positive", "negative", "neutral"]).describe("Overall sentiment"),
});

export async function createAnalystApp() {
  const llm = await getLlm();

  const analyst = makeAgent({
    name: "analyst",
    llm,
    tools: [echo],
    system:
      "You analyze text and produce structured summaries with key points and sentiment.",
    responseFormat: SummarySchema,
  });

  return makeSupervisor({
    agents: [analyst],
    llm,
    outputMode: "last_message",
    supervisorName: "analyst_supervisor",
  });
}
