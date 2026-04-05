import { z } from "zod";
import { tool } from "@langchain/core/tools";

export const webSearch = tool(
  async ({ query }) => {
    // Uses the free DuckDuckGo instant answer API — no key required
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const res = await fetch(url);
    const data = (await res.json()) as Record<string, unknown>;

    const results: string[] = [];
    if (data.AbstractText) results.push(String(data.AbstractText));
    if (Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic && typeof topic === "object" && "Text" in topic) {
          results.push(String((topic as { Text: string }).Text));
        }
      }
    }

    return results.length > 0
      ? results.join("\n\n")
      : `No results found for "${query}". Try rephrasing.`;
  },
  {
    name: "web_search",
    description: "Search the web for current information using DuckDuckGo",
    schema: z.object({
      query: z.string().describe("The search query"),
    }),
  }
);

export const scrapeUrl = tool(
  async ({ url }) => {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "LangGraph-Starter-Kit/1.0" },
      });
      const html = await res.text();
      // Strip HTML tags for a rough text extraction
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return text.slice(0, 4000);
    } catch (err) {
      return `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: "scrape_url",
    description: "Fetch and extract text content from a URL",
    schema: z.object({
      url: z.string().url().describe("The URL to scrape"),
    }),
  }
);
