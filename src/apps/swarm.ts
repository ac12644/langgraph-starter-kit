import type { DynamicStructuredTool } from "@langchain/core/tools";
import { llm } from "../config/llm";
import { add, multiply, echo } from "../tools/local";
import { makeAgent } from "../agents/factory";
import { createHandoffTool } from "../agents/handoff";
import { makeSwarm, type MakeSwarmParams } from "../agents/swarm";

export function createSwarmApp(mcpTools: DynamicStructuredTool[] = []) {
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
    system: "You are Bob; speak like a pirate.",
  });

  return makeSwarm({
    agents: [alice, bob] as unknown as MakeSwarmParams["agents"],
    defaultActiveAgent: "alice",
  });
}
