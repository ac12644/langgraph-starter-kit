import { z } from "zod";
import { AIMessage } from "@langchain/core/messages";
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  START,
  END,
} from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { AgentGraph } from "./factory";

/**
 * Swarm via the "handoffs" pattern: each agent is a graph node, and handoff
 * tools (see ./handoff.ts) jump between nodes while flipping `activeAgent`.
 * This replaces @langchain/langgraph-swarm, which is no longer actively
 * maintained.
 *
 * `activeAgent` is checkpointed, so on the next turn of the same thread the
 * conversation resumes with whichever agent last held it — same semantics
 * as the old createSwarm.
 */

export const SwarmState = new StateSchema({
  messages: MessagesValue,
  activeAgent: z.string().optional(),
});

export type SwarmStateType = typeof SwarmState.State;

export interface SwarmAgentSpec {
  /** Node name; handoff tools reference it as transfer_to_<name>. */
  name: string;
  agent: AgentGraph;
}

export interface MakeSwarmParams {
  agents: SwarmAgentSpec[];
  defaultActiveAgent: string;
  checkpointer?: BaseCheckpointSaver;
}

export async function makeSwarm({
  agents,
  defaultActiveAgent,
  checkpointer,
}: MakeSwarmParams) {
  const names = agents.map((a) => a.name);

  const routeToActive = (state: SwarmStateType) =>
    state.activeAgent ?? defaultActiveAgent;

  // After an agent runs: done if it answered (no pending tool calls);
  // otherwise a handoff moved `activeAgent`, so continue there.
  const routeAfterAgent = (state: SwarmStateType) => {
    const last = state.messages.at(-1);
    if (last && AIMessage.isInstance(last) && !last.tool_calls?.length) {
      return END;
    }
    return state.activeAgent ?? defaultActiveAgent;
  };

  // Node names are only known at runtime, so the graph is built with
  // string keys and the routers are cast to the node-name union.
  let builder = new StateGraph(SwarmState) as StateGraph<
    typeof SwarmState,
    SwarmStateType
  >;
  for (const { name, agent } of agents) {
    builder = builder.addNode(name, async (state: SwarmStateType) =>
      agent.invoke(state)
    ) as typeof builder;
  }

  builder.addConditionalEdges(START, routeToActive as never, names as never);
  for (const name of names) {
    builder.addConditionalEdges(
      name as never,
      routeAfterAgent as never,
      [...names, END] as never
    );
  }

  // Lazy import: config/env validates provider API keys at import time,
  // which callers supplying their own checkpointer (e.g. tests) shouldn't
  // have to satisfy.
  const resolvedCheckpointer =
    checkpointer ?? (await (await import("../config/checkpointer")).getCheckpointer());

  return builder.compile({
    checkpointer: resolvedCheckpointer,
  });
}
