import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Current OpenAI and Claude models reject a non-default temperature, so the
// request params for their defaults must not carry one.
type WithParams = { invocationParams(): { temperature?: number } };

describe("llm config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("LLM_MODEL", "");
    vi.stubEnv("LLM_TEMPERATURE", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["anthropic", "ANTHROPIC_API_KEY"],
    ["openai", "OPENAI_API_KEY"],
  ])("does not send a temperature to the default %s model", async (provider, key) => {
    vi.stubEnv("LLM_PROVIDER", provider);
    vi.stubEnv(key, "test-key");
    const { getLlm } = await import("../../src/config/llm");
    const llm = (await getLlm()) as unknown as WithParams;

    expect(llm.invocationParams().temperature).toBeUndefined();
  });

  it("still defaults other providers to temperature 0", async () => {
    vi.stubEnv("LLM_PROVIDER", "ollama");
    const { getLlm } = await import("../../src/config/llm");
    const llm = (await getLlm()) as unknown as { temperature?: number };

    expect(llm.temperature).toBe(0);
  });
});
