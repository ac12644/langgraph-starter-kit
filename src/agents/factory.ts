import { createAgent, type ResponseFormat, type TypedToolStrategy } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph-checkpoint";

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
  /** Cross-thread memory store. Like `checkpointer`, set it on the outermost agent only. */
  store?: BaseStore;
  /**
   * Middleware wrapping the agent loop — summarization, call limits, retries,
   * PII redaction. See docs/BUILDING.md#middleware.
   */
  middleware?: CreateAgentParams["middleware"];
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
  store,
  middleware,
}: MakeAgentParams) {
  return createAgent({
    name,
    model: llm,
    tools,
    ...(system ? { systemPrompt: system } : {}),
    ...(responseFormat ? { responseFormat } : {}),
    ...(checkpointer ? { checkpointer } : {}),
    ...(store ? { store } : {}),
    ...(middleware ? { middleware } : {}),
  });
}

export type AgentGraph = ReturnType<typeof makeAgent>;
