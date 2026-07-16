import type { DynamicStructuredTool } from "@langchain/core/tools";
import { getLlm } from "../config/llm";
import { add, multiply, echo } from "../tools/local";
import { makeAgent } from "../agents/factory";
import { createHandoffTool } from "../agents/handoff";
import { makeSwarm } from "../agents/swarm";

export async function createSwarmApp(mcpTools: DynamicStructuredTool[] = []) {
  const llm = await getLlm();

  const alice = makeAgent({
    name: "alice",
    llm,
    tools: [add, ...mcpTools, createHandoffTool({ agentName: "bob" })],
    system: "You are Alice, an addition expert.",
  });

  const bob = makeAgent({
    name: "bob",
    llm,
    tools: [multiply, echo, createHandoffTool({ agentName: "alice" })],
    system: "You are Bob, a multiplication expert.",
  });

  return makeSwarm({
    agents: [
      { name: "alice", agent: alice },
      { name: "bob", agent: bob },
    ],
    defaultActiveAgent: "alice",
  });
}
