/**
 * Request validation helpers, kept in their own module (free of any
 * `config/env` import) so they can be unit-tested without API keys and
 * without booting the server.
 */

/** An error carrying an HTTP status, so the error handler doesn't default to 500. */
export function httpError(status: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: status });
}

/**
 * Roles a client may send. `system` is deliberately excluded: each app owns
 * its system prompt, and accepting one from the request lets any caller
 * override it.
 */
const CLIENT_ROLES = ["user", "assistant"];

/**
 * Validates the `messages` array before it reaches LangGraph. Without this a
 * malformed body (e.g. `"messages": "hi"`) is silently coerced into a message
 * and the agent runs on garbage, returning 200 — and an empty one still runs
 * the model on the thread's existing history.
 */
export function validateMessages(raw: unknown): { role: string; content: string }[] {
  if (!Array.isArray(raw)) {
    throw httpError(400, '"messages" must be an array');
  }
  if (raw.length === 0) {
    throw httpError(400, '"messages" must not be empty');
  }
  return raw.map((m, i) => {
    if (typeof m !== "object" || m === null) {
      throw httpError(400, `messages[${i}] must be an object with "role" and "content"`);
    }
    const { role, content } = m as Record<string, unknown>;
    if (typeof role !== "string" || typeof content !== "string") {
      throw httpError(400, `messages[${i}] needs string "role" and "content"`);
    }
    if (!CLIENT_ROLES.includes(role)) {
      throw httpError(400, `messages[${i}].role must be one of: ${CLIENT_ROLES.join(", ")}`);
    }
    return { role, content };
  });
}

/**
 * Validates `thread_id`, defaulting to "default" when it is omitted. A
 * non-string value otherwise reaches the checkpointer and fails as a 500
 * with LangGraph internals in the message.
 */
export function validateThreadId(raw: unknown): string {
  if (raw === undefined) return "default";
  if (typeof raw !== "string" || raw.trim() === "") {
    throw httpError(400, '"thread_id" must be a non-empty string');
  }
  return raw;
}
