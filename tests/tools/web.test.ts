import { afterEach, describe, it, expect, vi } from "vitest";
import { webSearch, scrapeUrl } from "../../src/tools/web";

afterEach(() => vi.unstubAllGlobals());

// A literal public IP, so the address check needs no DNS lookup.
const PUBLIC_URL = "https://93.184.215.14/";

describe("web tools", () => {
  describe("webSearch", () => {
    it("returns results for a known query", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({
            AbstractText: "TypeScript is a programming language",
            RelatedTopics: [{ Text: "TypeScript - A typed superset of JavaScript" }, { Text: "TypeScript compiler" }],
          })
        )
      );

      const result = await webSearch.invoke({ query: "TypeScript" });
      expect(result).toContain("TypeScript");
    });

    it("returns fallback message when no results", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ AbstractText: "", RelatedTopics: [] })));

      const result = await webSearch.invoke({ query: "xyznonexistent123" });
      expect(result).toContain("No results found");
    });
  });

  describe("scrapeUrl", () => {
    it("strips HTML and returns text", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("<html><body><h1>Hello</h1><p>World</p></body></html>"))
      );

      const result = await scrapeUrl.invoke({ url: PUBLIC_URL });
      expect(result).toContain("Hello");
      expect(result).toContain("World");
      expect(result).not.toContain("<h1>");
    });

    it("handles fetch errors gracefully", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

      const result = await scrapeUrl.invoke({ url: PUBLIC_URL });
      expect(result).toContain("Failed to fetch");
    });

    // The URL comes from the model, so a user can ask for anything.
    it.each([
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:3000/health",
      "http://localhost:3000/health",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "file:///etc/passwd",
    ])("refuses %s without fetching it", async (url) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const result = await scrapeUrl.invoke({ url });
      expect(result).toContain("Failed to fetch");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses a redirect to a private address", async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
      vi.stubGlobal("fetch", fetchSpy);

      const result = await scrapeUrl.invoke({ url: PUBLIC_URL });
      expect(result).toContain("169.254.169.254 is a private address");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("stops reading a huge response", async () => {
      let pulled = 0;
      const endless = new ReadableStream({
        pull(controller) {
          pulled += 64 * 1024;
          controller.enqueue(new TextEncoder().encode("a".repeat(64 * 1024)));
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(endless)));

      const result = await scrapeUrl.invoke({ url: PUBLIC_URL });
      expect(result).toHaveLength(4000);
      expect(pulled).toBeLessThan(2_000_000);
    });
  });
});
