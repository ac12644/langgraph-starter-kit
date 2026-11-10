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

/** The interrupt humanInTheLoopMiddleware raises: one entry per tool call. */
interface ApprovalRequest {
  actionRequests: unknown[];
  reviewConfigs: { allowedDecisions?: string[] }[];
}

function isApprovalRequest(value: unknown): value is ApprovalRequest {
  const v = value as Partial<ApprovalRequest> | undefined;
  return Array.isArray(v?.actionRequests) && Array.isArray(v?.reviewConfigs);
}

/**
 * Turns `"approve"`, `["approve", "reject"]` or decision objects into the
 * middleware's `{ decisions }`. Checked here because the middleware throws on
 * a bad answer: a 500 on a plain agent, and under a supervisor a tool error
 * the model reads while the run carries on.
 */
function approvalDecisions(request: ApprovalRequest, answer: unknown, field: string) {
  const answers = Array.isArray(answer) ? answer : [answer];
  const count = request.actionRequests.length;
  if (answers.length !== count) {
    throw httpError(400, `${field} needs one answer per action: ${count} pending, got ${answers.length}`);
  }
  const decisions = answers.map((a, i) => {
    const decision = typeof a === "string" ? { type: a } : (a as { type?: unknown } | null);
    const allowed = request.reviewConfigs[i]?.allowedDecisions ?? [];
    if (!decision || typeof decision.type !== "string" || !allowed.includes(decision.type)) {
      const at = count > 1 ? `${field}[${i}]` : field;
      throw httpError(400, `${at} must be one of: ${allowed.map((d) => JSON.stringify(d)).join(", ")}`);
    }
    return decision;
  });
  return { decisions };
}

/** Checks one answer and returns what to resume that interrupt with. */
function answerFor(interrupt: RawInterrupt, answer: unknown, field: string): unknown {
  if (isApprovalRequest(interrupt.value)) return approvalDecisions(interrupt.value, answer, field);
  assertDecisionAllowed(interrupt.response_schema, answer, field);
  return answer;
}

/**
 * Turns a /resume body into the value for `Command({ resume })`.
 *
 * - `decision` answers the one pending interrupt. With several pending it is
 *   a 400: LangGraph would hand the same value to all of them, so one "yes"
 *   would approve every action, including ones the client never showed.
 * - `decisions` maps interrupt ids to answers, one for every pending
 *   interrupt. A partial answer would run, but until the rest are answered
 *   the thread keeps listing the answered ones as pending (the parent step
 *   only completes once all of them return).
 *
 * For an approval interrupt (humanInTheLoopMiddleware) an answer is
 * `"approve"`/`"reject"`, or an array with one per pending tool call.
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
    const answers = Object.fromEntries(
      Object.entries(decisions).map(([id, decision]) => {
        const match = pending.find((i) => i.id === id);
        if (!match) throw httpError(400, `No pending interrupt with id "${id}"`);
        return [id, answerFor(match, decision, `decisions["${id}"]`)];
      })
    );
    const missing = pending.map((i) => i.id).filter((id) => id && !(id in answers));
    if (missing.length > 0) {
      throw httpError(400, `"decisions" must answer every pending interrupt; missing: ${missing.join(", ")}`);
    }
    return answers;
  }

  if (body.decision === undefined) {
    throw httpError(400, '"decision" is required');
  }
  if (pending.length > 1) {
    throw httpError(400, `${pending.length} interrupts are pending; send "decisions" keyed by interrupt id`);
  }
  return answerFor(pending[0] ?? {}, body.decision, '"decision"');
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
