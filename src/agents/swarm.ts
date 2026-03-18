import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { MessagesAnnotation, Annotation } from "@langchain/langgraph";
import { createSwarm } from "@langchain/langgraph-swarm";
import { getCheckpointer } from "../config/checkpointer";

export const SwarmState = Annotation.Root({
  ...MessagesAnnotation.spec,
  activeAgent: Annotation<string>(),
});

type SwarmParams = Parameters<typeof createSwarm>[0];

export interface MakeSwarmParams {
  agents: SwarmParams["agents"];
  defaultActiveAgent: string;
  checkpointer?: BaseCheckpointSaver;
  store?: BaseStore;
}

export function makeSwarm({
  agents,
  defaultActiveAgent,
  checkpointer,
  store,
}: MakeSwarmParams) {
  const graph = createSwarm({
    agents,
    defaultActiveAgent,
    stateSchema: SwarmState,
  });

  return graph.compile({
    checkpointer: checkpointer ?? getCheckpointer(),
    store,
  });
}
