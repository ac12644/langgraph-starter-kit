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
    subagents: [
      {
        name: "researcher",
        description:
          "Research a topic on the web and return findings with sources.",
        agent: researcher,
      },
      {
        name: "writer",
        description:
          "Turn research notes into a polished markdown report. Pass the full findings in the task.",
        agent: writer,
      },
    ],
    llm,
    supervisorName: "research_supervisor",
    prompt:
      "You coordinate a research team. Delegate research tasks to the researcher first, " +
      "then pass the findings to the writer for a polished report. " +
      "Only respond to the user once the writer has produced the final report.",
  });
}
