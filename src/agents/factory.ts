import { createAgent, type ResponseFormat, type TypedToolStrategy } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

type CreateAgentParams = Parameters<typeof createAgent>[0];

export interface MakeAgentParams {
  name: string;
  llm: BaseChatModel;
  tools?: CreateAgentParams["tools"];
  system?: string;
  responseFormat?: ResponseFormat | TypedToolStrategy<Record<string, unknown>>;
  /**
   * Only the outermost agent of a multi-agent setup should get a
   * checkpointer — subagents inherit it at runtime, which is what lets
   * `interrupt()` calls bubble up to the top-level graph.
   */
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Wraps LangChain's `createAgent` with a simpler interface.
 *
 * This used to wrap LangGraph's `createReactAgent`, which is deprecated in
 * v1 together with the @langchain/langgraph-supervisor and -swarm packages.
 * Agents built here are composed via the subagents pattern (see
 * ./supervisor.ts) or the handoffs pattern (see ./swarm.ts) instead.
 */
export function makeAgent({
  name,
  llm,
  tools = [],
  system,
  responseFormat,
  checkpointer,
}: MakeAgentParams) {
  return createAgent({
    name,
    model: llm,
    tools,
    ...(system ? { systemPrompt: system } : {}),
    ...(responseFormat ? { responseFormat } : {}),
    ...(checkpointer ? { checkpointer } : {}),
  });
}

export type AgentGraph = ReturnType<typeof makeAgent>;
