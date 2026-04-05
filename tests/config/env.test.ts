import { describe, it, expect, vi, beforeEach } from "vitest";

describe("env config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("defaults to openai provider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("LLM_PROVIDER", "");

    const env = await import("../../src/config/env");
    expect(env.LLM_PROVIDER).toBe("openai");

    vi.unstubAllEnvs();
  });

  it("throws on invalid provider", async () => {
    vi.stubEnv("LLM_PROVIDER", "invalid_provider");

    await expect(import("../../src/config/env")).rejects.toThrow(
      /Invalid LLM_PROVIDER/
    );

    vi.unstubAllEnvs();
  });

  it("throws when API key is missing for provider", async () => {
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    await expect(import("../../src/config/env")).rejects.toThrow(
      /ANTHROPIC_API_KEY.*required/
    );

    vi.unstubAllEnvs();
  });

  it("does not require API key for ollama", async () => {
    vi.stubEnv("LLM_PROVIDER", "ollama");

    const env = await import("../../src/config/env");
    expect(env.LLM_PROVIDER).toBe("ollama");

    vi.unstubAllEnvs();
  });

  it("parses PORT and LLM_TEMPERATURE as numbers", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("PORT", "8080");
    vi.stubEnv("LLM_TEMPERATURE", "0.7");

    const env = await import("../../src/config/env");
    expect(env.PORT).toBe(8080);
    expect(env.LLM_TEMPERATURE).toBe(0.7);

    vi.unstubAllEnvs();
  });
});
