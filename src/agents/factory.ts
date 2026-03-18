import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  createReactAgent,
  createReactAgentAnnotation,
} from "@langchain/langgraph/prebuilt";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { BaseMessage, SystemMessage } from "@langchain/core/messages";

type ReactAgentParams = Parameters<typeof createReactAgent>[0];

export interface MakeAgentParams {
  name: string;
  llm: BaseChatModel;
  tools?: ReactAgentParams["tools"];
  system?: string;
  privateMessagesKey?: string;
  responseFormat?: ReactAgentParams["responseFormat"];
}

export function privateMessagesSchema(key: string) {
  return Annotation.Root({
    [key]: Annotation<BaseMessage[]>({
      reducer: messagesStateReducer,
      default: () => [],
    }),
  });
}

export function makeAgent({
  name,
  llm,
  tools = [],
  system,
  privateMessagesKey,
  responseFormat,
}: MakeAgentParams) {
  const stateSchema = privateMessagesKey
    ? privateMessagesSchema(privateMessagesKey)
    : createReactAgentAnnotation();

  const msgKey = privateMessagesKey;
  const prompt =
    typeof system === "string"
      ? (state: Record<string, BaseMessage[]>) => [
          new SystemMessage(system),
          ...(state.messages ?? (msgKey ? state[msgKey] : []) ?? []),
        ]
      : undefined;

  return createReactAgent({
    name,
    llm,
    tools,
    stateSchema,
    prompt,
    ...(responseFormat ? { responseFormat } : {}),
  });
}
