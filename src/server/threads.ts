import { httpError } from "./validation";

/**
 * Thread-state helpers for the HTTP routes. Like ./validation, this module
 * stays free of `config/env` so it can be tested against a real graph
 * without API keys.
 */

interface RawInterrupt {
  id?: string;
  value?: unknown;
  response_schema?: unknown;
}

export interface ThreadState {
  values?: unknown;
  next?: string[];
  tasks?: { interrupts?: RawInterrupt[] }[];
  createdAt?: string | null;
}

interface HasState {
  getState(config: unknown): Promise<ThreadState | undefined>;
}

/** What a paused thread is waiting on, as returned to clients. */
export interface PendingInterrupt {
  id: string;
  value: unknown;
}

function rawInterrupts(state: ThreadState | undefined): RawInterrupt[] {
  return (state?.tasks ?? []).flatMap((t) => t.interrupts ?? []);
}

/**
 * The interrupts a paused thread is waiting on: each `interrupt()` call's
 * payload and its id. Empty when the thread isn't paused. The id is what a
 * client sends back in `decisions` when more than one is pending.
 */
export function pendingInterrupts(state: ThreadState | undefined): PendingInterrupt[] {
  return rawInterrupts(state).map(({ id, value }) => ({ id: id ?? "", value }));
}

/**
 * Rejects a decision that the interrupt's `responseSchema` doesn't allow.
 * LangGraph validates it too, but inside a createAgent tool a failed
 * validation goes back to the model as a tool error and the run carries on,
 * so the caller never hears about it. Checking here gives them a 400 and
 * leaves the thread paused.
 *
 * Only `enum` and primitive `type` schemas are checked, which covers the HITL
 * tools here. Richer schemas would need a JSON Schema validator such as ajv.
 */
function assertDecisionAllowed(schema: unknown, decision: unknown, field: string): void {
  const s = schema as { enum?: unknown[]; type?: string } | undefined;
  if (s?.enum && !s.enum.includes(decision)) {
    throw httpError(400, `${field} must be one of: ${s.enum.map((v) => JSON.stringify(v)).join(", ")}`);
  }
  if (["string", "number", "boolean"].includes(s?.type ?? "") && typeof decision !== s?.type) {
    throw httpError(400, `${field} must be a ${s?.type}`);
  }
}

/**
 * Turns a /resume body into the value for `Command({ resume })`.
 *
 * - `decision` answers the one pending interrupt. With several pending it is
 *   a 400: LangGraph would hand the same value to all of them, so one "yes"
 *   would approve every action, including ones the client never showed.
 * - `decisions` maps interrupt ids to answers. Ids not listed stay pending.
 */
export function resumeValue(
  state: ThreadState,
  body: { decision?: unknown; decisions?: unknown }
): unknown {
  const pending = rawInterrupts(state);

  if (body.decisions !== undefined) {
    const decisions = body.decisions;
    if (typeof decisions !== "object" || decisions === null || Array.isArray(decisions) || Object.keys(decisions).length === 0) {
      throw httpError(400, '"decisions" must be an object of interrupt id to decision');
    }
    for (const [id, decision] of Object.entries(decisions)) {
      const match = pending.find((i) => i.id === id);
      if (!match) throw httpError(400, `No pending interrupt with id "${id}"`);
      assertDecisionAllowed(match.response_schema, decision, `decisions["${id}"]`);
    }
    return decisions;
  }

  if (body.decision === undefined) {
    throw httpError(400, '"decision" is required');
  }
  if (pending.length > 1) {
    throw httpError(400, `${pending.length} interrupts are pending; send "decisions" keyed by interrupt id`);
  }
  assertDecisionAllowed(pending[0]?.response_schema, body.decision, '"decision"');
  return body.decision;
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
