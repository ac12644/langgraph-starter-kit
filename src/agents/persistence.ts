import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph-checkpoint";

export interface Persistence {
  checkpointer?: BaseCheckpointSaver;
  store?: BaseStore;
}

/**
 * Fills in the checkpointer and store a composed graph should compile with.
 *
 * This module deliberately has no top-level import of `../config/checkpointer`.
 * That module reaches `config/env`, which validates provider API keys **at
 * import time** — so importing it eagerly makes every consumer require a key,
 * including tests that supply their own checkpointer and never touch a
 * provider. Loading it inside the function keeps that cost on the path that
 * actually needs it.
 *
 * Callers that bring their own checkpointer are expected to bring their own
 * store too, if they want one: supplying a checkpointer means "I am managing
 * persistence", so we don't reach for config on their behalf.
 */
export async function resolvePersistence({
  checkpointer,
  store,
}: Persistence): Promise<Persistence> {
  if (checkpointer) return { checkpointer, store };

  const config = await import("../config/checkpointer");
  return {
    checkpointer: await config.getCheckpointer(),
    store: store ?? config.getStore(),
  };
}
