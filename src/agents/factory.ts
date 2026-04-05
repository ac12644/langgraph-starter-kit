import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  createReactAgent,
  type CreateReactAgentParams,
} from "@langchain/langgraph/prebuilt";

export interface MakeAgentParams {
  name: string;
  llm: BaseChatModel;
  tools?: StructuredToolInterface[];
  system?: string;
  responseFormat?: CreateReactAgentParams["responseFormat"];
}

/**
 * Wraps createReactAgent with a simpler interface.
 *
 * NOTE: createReactAgent is deprecated in LangGraph v1 in favor of
 * `createAgent` from the `langchain` package. However, the supervisor
 * and swarm packages (@langchain/langgraph-supervisor, @langchain/langgraph-swarm)
 * do not yet accept the new ReactAgent type. Once they do, migrate this
 * factory to use `createAgent` from "langchain".
 */
export function makeAgent({
  name,
  llm,
  tools = [],
  system,
  responseFormat,
}: MakeAgentParams) {
  return createReactAgent({
    name,
    llm,
    tools,
    ...(system ? { prompt: system } : {}),
    ...(responseFormat ? { responseFormat } : {}),
  });
}
