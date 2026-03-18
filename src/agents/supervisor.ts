import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { createSupervisor } from "@langchain/langgraph-supervisor";
import { getCheckpointer, getStore } from "../config/checkpointer";

type SupervisorParams = Parameters<typeof createSupervisor>[0];

export interface MakeSupervisorParams extends SupervisorParams {
  checkpointer?: BaseCheckpointSaver;
  store?: BaseStore;
}

export function makeSupervisor({
  checkpointer,
  store,
  ...supervisorParams
}: MakeSupervisorParams) {
  const wf = createSupervisor(supervisorParams);

  return wf.compile({
    checkpointer: checkpointer ?? getCheckpointer(),
    store: store ?? getStore(),
  });
}
