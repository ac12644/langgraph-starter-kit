import type { DynamicStructuredTool } from "@langchain/core/tools";
import { getLlm } from "../config/llm";
import { add, multiply, echo } from "../tools/local";
import { makeAgent } from "../agents/factory";
import { makeSupervisor } from "../agents/supervisor";

export async function createSupervisorApp(mcpTools: DynamicStructuredTool[] = []) {
  const llm = await getLlm();

  const math = makeAgent({
    name: "math_expert",
    llm,
    tools: [add, multiply, ...mcpTools],
    system: "You are a math expert. Use one tool at a time.",
  });

  const writer = makeAgent({
    name: "writer",
    llm,
    tools: [echo],
    system: "You write crisp, structured answers.",
  });

  return makeSupervisor({
    agents: [math, writer],
    llm,
    outputMode: "last_message",
    supervisorName: "supervisor",
  });
}
