import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

export const webSearch = tool(
  async ({ query }) => {
    // Uses the free DuckDuckGo instant answer API — no key required
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
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

/**
 * Addresses scrape_url must never reach. The URL comes from the model, and
 * the model takes it from the user, so without this anyone who can talk to
 * the researcher can read the cloud metadata endpoint (169.254.169.254) or
 * services on the server's private network.
 */
const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, includes cloud metadata
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  PRIVATE.addSubnet(net, prefix, "ipv4");
}
// IPv4-mapped IPv6 (::ffff:127.0.0.1) needs no rule: BlockList checks it
// against the IPv4 subnets above.
for (const [net, prefix] of [
  ["::", 127], // unspecified and loopback
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
] as const) {
  PRIVATE.addSubnet(net, prefix, "ipv6");
}

/**
 * Throws unless the URL is http(s) and its host resolves only to public
 * addresses.
 *
 * fetch resolves the name again, so a host that changes its DNS answer
 * between this check and the request (DNS rebinding) can still get through.
 * Pin the checked address with a custom undici dispatcher if that matters.
 */
async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only http and https URLs are allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  for (const { address, family } of addresses) {
    if (PRIVATE.check(address, family === 6 ? "ipv6" : "ipv4")) {
      throw new Error(`${url.hostname} is a private address`);
    }
  }
}

/** Reads at most `max` bytes of the body, then stops the download. */
async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, max));
}

/** fetch with the address check applied to the URL and to every redirect. */
async function fetchPublic(raw: string): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url = new URL(raw);
  for (let redirects = 0; ; redirects++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      headers: { "User-Agent": "LangGraph-Starter-Kit/1.0" },
      redirect: "manual",
      signal,
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (redirects >= MAX_REDIRECTS) throw new Error("too many redirects");
      url = new URL(location, url);
      continue;
    }
    return readCapped(res, MAX_BYTES);
  }
}

export const scrapeUrl = tool(
  async ({ url }) => {
    try {
      const html = await fetchPublic(url);
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
    description: "Fetch and extract text content from a public http(s) URL",
    schema: z.object({
      url: z.string().url().describe("The URL to scrape"),
    }),
  }
);
