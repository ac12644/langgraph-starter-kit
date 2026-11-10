import { httpError } from "./validation";

/**
 * Thread-state helpers for the HTTP routes. Like ./validation, this module
 * stays free of `config/env` so it can be tested against a real graph
 * without API keys.
 */

export interface ThreadState {
  values?: unknown;
  next?: string[];
  tasks?: { interrupts?: { value?: unknown; response_schema?: unknown }[] }[];
  createdAt?: string | null;
}

interface HasState {
  getState(config: unknown): Promise<ThreadState | undefined>;
}

/**
 * The payloads a paused thread is waiting on — what each `interrupt()` call
 * was given. Empty when the thread isn't paused.
 */
export function pendingInterrupts(state: ThreadState | undefined): unknown[] {
  return (state?.tasks ?? []).flatMap((t) => t.interrupts ?? []).map((i) => i.value);
}

/**
 * Rejects a decision that the paused interrupt's `responseSchema` doesn't
 * allow. LangGraph validates it too, but inside a createAgent tool a failed
 * validation goes back to the model as a tool error and the run carries on,
 * so the caller never hears about it. Checking here gives them a 400 and
 * leaves the thread paused.
 *
 * Only `enum` and primitive `type` schemas are checked, which covers the HITL
 * tools here. Richer schemas would need a JSON Schema validator such as ajv.
 */
export function assertDecisionAllowed(state: ThreadState | undefined, decision: unknown): void {
  const interrupts = (state?.tasks ?? []).flatMap((t) => t.interrupts ?? []);
  for (const { response_schema } of interrupts) {
    const schema = response_schema as { enum?: unknown[]; type?: string } | undefined;
    if (schema?.enum && !schema.enum.includes(decision)) {
      throw httpError(400, `"decision" must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`);
    }
    if (["string", "number", "boolean"].includes(schema?.type ?? "") && typeof decision !== schema?.type) {
      throw httpError(400, `"decision" must be a ${schema?.type}`);
    }
  }
}

/**
 * Loads a thread's state, or throws 404. getState() on a thread that never
 * ran still returns a snapshot (with `values: {}`), so existence is whether
 * it has a checkpoint: `createdAt`.
 */
export async function getThread(app: HasState, threadId: string): Promise<ThreadState> {
  const state = await app.getState({ configurable: { thread_id: threadId } });
  if (!state?.createdAt) {
    throw httpError(404, `Thread "${threadId}" not found`);
  }
  return state;
}
