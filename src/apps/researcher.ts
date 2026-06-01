import { getLlm } from "../config/llm";
import { webSearch, scrapeUrl } from "../tools/web";
import { makeAgent } from "../agents/factory";
import { makeSupervisor } from "../agents/supervisor";

export async function createResearcherApp() {
  const llm = await getLlm();

  const researcher = makeAgent({
    name: "researcher",
    llm,
    tools: [webSearch, scrapeUrl],
    system: [
      "You are a research specialist. You search the web to find accurate, up-to-date information.",
      "Always cite your sources. Search multiple queries if the first one doesn't give good results.",
      "When asked to research a topic, be thorough — search for different angles.",
    ].join("\n"),
  });

  const writer = makeAgent({
    name: "writer",
    llm,
    tools: [],
    system: [
      "You are an expert writer. You take research notes and produce clear, well-structured reports.",
      "Use markdown formatting. Include headers, bullet points, and bold key findings.",
      "Always end with a Sources section listing where the information came from.",
    ].join("\n"),
  });

  return makeSupervisor({
    agents: [researcher, writer],
    llm,
    outputMode: "last_message",
    supervisorName: "research_supervisor",
    prompt:
      "You coordinate a research team. Route research tasks to the researcher first, " +
      "then send the findings to the writer for a polished report. " +
      "Only respond to the user once the writer has produced the final report.",
  });
}
