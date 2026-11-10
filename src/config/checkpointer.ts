import { MemorySaver, InMemoryStore } from "@langchain/langgraph";
import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph-checkpoint";
import { DATABASE_URL } from "./env";

let _checkpointer: Promise<BaseCheckpointSaver> | undefined;

/**
 * Returns a checkpointer for graph compilation.
 *
 * - No `DATABASE_URL`  → in-memory `MemorySaver` (state is lost on restart).
 * - `DATABASE_URL` set → Postgres-backed `PostgresSaver`, with tables created
 *   on first run via `setup()` (idempotent).
 *
 * Memoized: every app shares one instance, so Postgres gets one connection
 * pool and one `setup()`, not one per app. The server keeps apps' threads
 * apart by prefixing thread ids (see scopeThreads in server/app.ts).
 *
 * `@langchain/langgraph-checkpoint-postgres` is an optional dependency, loaded
 * lazily so the `pg` driver is only pulled in when Postgres is actually used.
 */
export function getCheckpointer(): Promise<BaseCheckpointSaver> {
  _checkpointer ??= createCheckpointer();
  return _checkpointer;
}

/** Closes the Postgres pool, if one was opened. Call on shutdown. */
export async function closeCheckpointer(): Promise<void> {
  const saver = (await _checkpointer) as { end?: () => Promise<void> } | undefined;
  await saver?.end?.();
}

async function createCheckpointer(): Promise<BaseCheckpointSaver> {
  if (!DATABASE_URL) {
    return new MemorySaver();
  }

  let PostgresSaver: typeof import("@langchain/langgraph-checkpoint-postgres").PostgresSaver;
  try {
    ({ PostgresSaver } = await import("@langchain/langgraph-checkpoint-postgres"));
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      throw new Error(
        "DATABASE_URL is set but @langchain/langgraph-checkpoint-postgres is not installed. " +
          "Run: npm install @langchain/langgraph-checkpoint-postgres"
      );
    }
    throw err;
  }

  const saver = PostgresSaver.fromConnString(DATABASE_URL);
  await saver.setup(); // creates checkpoint tables if missing — safe to re-run
  return saver;
}

export function getStore(): BaseStore {
  // Cross-thread memory store. Stays in-memory even with Postgres checkpointing;
  // swap for a persistent store if you need long-term memory across restarts.
  return new InMemoryStore();
}
