import { describe, expect, it } from "vitest";
import { httpError, validateMessages } from "../../src/server/validation";

/**
 * Regression tests for the request-validation helpers in the HTTP server.
 * These mirror the exported logic without booting Fastify or an LLM.
 *
 * Before these fixes: an unknown app returned 500 (not 404), and a malformed
 * body like `{"messages": "hi"}` returned 200 — LangChain coerced the string
 * into a message and ran the agent on it.
 */

describe("validateMessages", () => {
  it("accepts a well-formed messages array", () => {
    expect(validateMessages([{ role: "user", content: "hi" }])).toEqual([
      { role: "user", content: "hi" },
    ]);
  });

  it("treats a missing messages field as empty", () => {
    expect(validateMessages(undefined)).toEqual([]);
  });

  it("rejects a string instead of an array with 400", () => {
    try {
      validateMessages("not-an-array");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { statusCode: number }).statusCode).toBe(400);
      expect((err as Error).message).toContain("must be an array");
    }
  });

  it("rejects a message missing content with 400", () => {
    try {
      validateMessages([{ role: "user" }]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { statusCode: number }).statusCode).toBe(400);
      expect((err as Error).message).toContain('needs string "role" and "content"');
    }
  });

  it("rejects a non-object entry with 400", () => {
    try {
      validateMessages(["hello"]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { statusCode: number }).statusCode).toBe(400);
    }
  });
});

describe("httpError", () => {
  it("carries a status the Fastify error handler reads", () => {
    const err = httpError(404, 'Unknown app: "nope"');
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain("nope");
  });
});
