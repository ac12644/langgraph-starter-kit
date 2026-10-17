import { MCPAdapter, type MCPAdapterConfig } from "@langchain/mcp-adapters";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { readFileSync, existsSync } from "fs";
import { MCP_SERVERS_PATH } from "../config/env";

interface McpLoadResult {
  tools: DynamicStructuredTool[];
  client: MCPAdapter | null;
}

const EMPTY: McpLoadResult = { tools: [], client: null };

let _cached: McpLoadResult | null = null;

export async function loadMcpTools(configPath?: string): Promise<McpLoadResult> {
  if (_cached) return _cached;

  const filePath = configPath ?? MCP_SERVERS_PATH;
  if (!filePath || !existsSync(filePath)) return EMPTY;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse MCP config at ${filePath}: ${msg}`);
  }

  if (typeof raw !== "object" || raw === null || Object.keys(raw).length === 0) {
    return EMPTY;
  }

  // mcp-servers.json is a flat map of servers. Keep tool names unprefixed, as
  // in mcp-adapters 1.x; with this off, two servers exposing the same tool name
  // throw instead of silently shadowing each other.
  let client: MCPAdapter;
  try {
    client = new MCPAdapter({
      servers: raw as MCPAdapterConfig["servers"],
      prefixToolNameWithServerName: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid MCP config at ${filePath}: ${msg}`);
  }

  let tools: DynamicStructuredTool[];
  try {
    tools = await client.listTools();
  } catch (err) {
    // Close any stdio servers that did start, or they keep the process alive.
    await client.close().catch(() => {});
    throw err;
  }

  if (tools.length > 0) {
    console.log(`MCP: loaded ${tools.length} tool(s) from ${filePath}`);
    for (const t of tools) {
      console.log(`  - ${t.name}: ${t.description}`);
    }
  }

  _cached = { tools, client };
  return _cached;
}
