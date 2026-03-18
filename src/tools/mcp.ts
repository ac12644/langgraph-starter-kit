import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { readFileSync, existsSync } from "fs";
import { MCP_SERVERS_PATH } from "../config/env";

interface McpLoadResult {
  tools: DynamicStructuredTool[];
  client: MultiServerMCPClient | null;
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

  const client = new MultiServerMCPClient(
    raw as ConstructorParameters<typeof MultiServerMCPClient>[0]
  );

  const tools = await client.getTools();

  if (tools.length > 0) {
    console.log(`MCP: loaded ${tools.length} tool(s) from ${filePath}`);
    for (const t of tools) {
      console.log(`  - ${t.name}: ${t.description}`);
    }
  }

  _cached = { tools, client };
  return _cached;
}

export function getMcpTools(): DynamicStructuredTool[] {
  return _cached?.tools ?? [];
}
