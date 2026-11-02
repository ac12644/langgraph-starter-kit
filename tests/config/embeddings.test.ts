import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("embeddings config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("implicit fallback to OpenAI requires OPENAI_API_KEY", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => { });
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubEnv("OPENAI_API_KEY", "");

    const { createEmbeddings } = await import("../../src/config/embeddings");

    await expect(createEmbeddings()).rejects.toThrow(/OPENAI_API_KEY/);
  });

  // #41: startup indexes the RAG docs, so with the default 6 retries an
  // unreachable embeddings endpoint held up startup for ~100s.
  it("RAG indexing gives up quickly when the embeddings endpoint is down", async () => {
    vi.stubEnv("LLM_PROVIDER", "ollama");
    vi.stubEnv("EMBEDDINGS_PROVIDER", "ollama");
    vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:1"); // nothing listens here

    const { initRagStore } = await import("../../src/apps/rag");

    const started = Date.now();
    await expect(initRagStore()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it("explicit ollama provider needs no OpenAI key", async () => {
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubEnv("EMBEDDINGS_PROVIDER", "ollama");
    vi.stubEnv("OPENAI_API_KEY", "");

    const { createEmbeddings } = await import("../../src/config/embeddings");
    const embeddings = await createEmbeddings();

    expect(typeof embeddings.embedQuery).toBe("function");
  });

  it("throws on explicit invalid embeddings provider when embeddings are created", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("EMBEDDINGS_PROVIDER", "deepseek");

    const { createEmbeddings } = await import("../../src/config/embeddings");

    await expect(createEmbeddings()).rejects.toThrow(/Invalid EMBEDDINGS_PROVIDER/);
  });

  it("defaults embeddings provider to openai for openai chat", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

    const { createEmbeddings } = await import("../../src/config/embeddings");
    const embeddings = await createEmbeddings();

    expect(typeof embeddings.embedQuery).toBe("function");
  });

  it("accepts EMBEDDINGS_MODEL pass-through without error", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("EMBEDDINGS_MODEL", "custom-model");

    const { createEmbeddings } = await import("../../src/config/embeddings");
    const embeddings = await createEmbeddings();

    expect(typeof embeddings.embedQuery).toBe("function");
  });

  it("does not validate embeddings key at env import time", async () => {
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubEnv("OPENAI_API_KEY", "");

    const env = await import("../../src/config/env");
    expect(env.EMBEDDINGS_PROVIDER_RAW).toBeUndefined();
  });

  it("logs implicit fallback once", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

    const { createEmbeddings } = await import("../../src/config/embeddings");
    await createEmbeddings();
    await createEmbeddings();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("deepseek has no embeddings API")
    );
  });
});
