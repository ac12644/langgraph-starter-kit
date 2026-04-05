import { describe, it, expect, vi } from "vitest";
import { webSearch, scrapeUrl } from "../../src/tools/web";

describe("web tools", () => {
  describe("webSearch", () => {
    it("returns results for a known query", async () => {
      const mockResponse = {
        AbstractText: "TypeScript is a programming language",
        RelatedTopics: [
          { Text: "TypeScript - A typed superset of JavaScript" },
          { Text: "TypeScript compiler" },
        ],
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          json: () => Promise.resolve(mockResponse),
        })
      );

      const result = await webSearch.invoke({ query: "TypeScript" });
      expect(result).toContain("TypeScript");

      vi.restoreAllMocks();
    });

    it("returns fallback message when no results", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          json: () =>
            Promise.resolve({ AbstractText: "", RelatedTopics: [] }),
        })
      );

      const result = await webSearch.invoke({ query: "xyznonexistent123" });
      expect(result).toContain("No results found");

      vi.restoreAllMocks();
    });
  });

  describe("scrapeUrl", () => {
    it("strips HTML and returns text", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          text: () =>
            Promise.resolve(
              "<html><body><h1>Hello</h1><p>World</p></body></html>"
            ),
        })
      );

      const result = await scrapeUrl.invoke({ url: "https://example.com" });
      expect(result).toContain("Hello");
      expect(result).toContain("World");
      expect(result).not.toContain("<h1>");

      vi.restoreAllMocks();
    });

    it("handles fetch errors gracefully", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network error"))
      );

      const result = await scrapeUrl.invoke({
        url: "https://unreachable.test",
      });
      expect(result).toContain("Failed to fetch");

      vi.restoreAllMocks();
    });
  });
});
