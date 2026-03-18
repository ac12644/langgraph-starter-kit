import { MemorySaver, InMemoryStore } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { BaseStore } from "@langchain/langgraph-checkpoint";

/**
 * Returns a checkpointer for graph compilation.
 *
 * Uses MemorySaver for development. To switch to PostgreSQL:
 *   1. npm install @langchain/langgraph-checkpoint-postgres
 *   2. Set DATABASE_URL in .env
 *   3. Uncomment the PostgresSaver block below.
 */
export function getCheckpointer(): BaseCheckpointSaver {
  // import { DATABASE_URL } from "./env";
  // if (DATABASE_URL) {
  //   const { PostgresSaver } = require("@langchain/langgraph-checkpoint-postgres");
  //   const saver = PostgresSaver.fromConnString(DATABASE_URL);
  //   await saver.setup();
  //   return saver;
  // }
  return new MemorySaver();
}

export function getStore(): BaseStore {
  return new InMemoryStore();
}
