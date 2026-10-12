import { httpError } from "./validation";

/**
 * Thread-state helpers for the HTTP routes. Like ./validation, this module
 * stays free of `config/env` so it can be tested against a real graph
 * without API keys.
 */

export interface ThreadState {
  values?: unknown;
  next?: string[];
  tasks?: { interrupts?: { value?: unknown }[] }[];
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
