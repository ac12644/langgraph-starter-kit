import { expect, it, vi } from "vitest";

// Dummy key: config/env checks the default provider's key at import.
vi.stubEnv("OPENAI_API_KEY", "test");
vi.stubEnv("DATABASE_URL", "");

const { getCheckpointer, closeCheckpointer } = await import("../../src/config/checkpointer");

// One instance for every app: with Postgres, each extra one was another
// connection pool and another setup() run.
it("returns the same checkpointer every time", async () => {
  expect(await getCheckpointer()).toBe(await getCheckpointer());
  await expect(closeCheckpointer()).resolves.toBeUndefined();
});
