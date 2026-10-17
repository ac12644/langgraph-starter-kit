import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MCPAdapter } from "@langchain/mcp-adapters";

// None of these connect to a server: config validation happens when the
// adapter is constructed, before any stdio process is spawned.
describe("MCP config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("the example config passes mcp-adapters validation", () => {
    const servers = JSON.parse(readFileSync("mcp-servers.example.json", "utf8"));
    expect(() => new MCPAdapter({ servers, prefixToolNameWithServerName: false })).not.toThrow();
  });

  it("rejects unknown options with the config path in the error", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "mcp-")), "bad.json");
    writeFileSync(path, JSON.stringify({ x: { transport: "stdio", command: "npx", bogus: true } }));
    const { loadMcpTools } = await import("../../src/tools/mcp");

    await expect(loadMcpTools(path)).rejects.toThrow(`Invalid MCP config at ${path}`);
  });

  it("returns no tools when the config file is missing", async () => {
    const { loadMcpTools } = await import("../../src/tools/mcp");

    expect((await loadMcpTools("does-not-exist.json")).tools).toEqual([]);
  });
});
