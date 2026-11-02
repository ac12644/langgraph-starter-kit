import { describe, expect, it, vi } from "vitest";
import { ProviderStrategy } from "langchain";

// Dummy key: tests never hit a real provider.
vi.stubEnv("OPENAI_API_KEY", "test");

const { analystResponseFormat } = await import("../../src/apps/analyst");

describe("analyst responseFormat", () => {
  it("uses native structured output on groq", () => {
    expect(analystResponseFormat("groq")).toBeInstanceOf(ProviderStrategy);
  });

  it("keeps toolStrategy for other providers", () => {
    for (const p of ["openai", "anthropic", "google", "ollama", "deepseek"] as const) {
      expect(analystResponseFormat(p)).not.toBeInstanceOf(ProviderStrategy);
    }
  });
});