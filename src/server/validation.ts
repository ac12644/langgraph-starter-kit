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
 * Validates the `messages` array before it reaches LangGraph. Without this a
 * malformed body (e.g. `"messages": "hi"`) is silently coerced into a message
 * and the agent runs on garbage, returning 200.
 */
export function validateMessages(raw: unknown): { role: string; content: string }[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw httpError(400, '"messages" must be an array');
  }
  return raw.map((m, i) => {
    if (typeof m !== "object" || m === null) {
      throw httpError(400, `messages[${i}] must be an object with "role" and "content"`);
    }
    const { role, content } = m as Record<string, unknown>;
    if (typeof role !== "string" || typeof content !== "string") {
      throw httpError(400, `messages[${i}] needs string "role" and "content"`);
    }
    return { role, content };
  });
}
