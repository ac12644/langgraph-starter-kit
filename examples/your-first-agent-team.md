# Your First Agent Team in 5 Minutes

This starter kit gives you a production-ready LangGraph setup with four working patterns out of the box.

## What you get

- **Swarm** — peer agents that hand off control to each other
- **Supervisor** — a central orchestrator that delegates to specialists
- **Human-in-the-loop** — agents that pause for human approval
- **Structured output** — agents that return validated, typed data
- **MCP tools** — plug in external tools from any MCP server via config
- **Streaming** — SSE endpoint for token-by-token output
- **Thread memory** — multi-turn conversations with checkpointed state

---

## Quick Start

```bash
git clone <this-repo> && cd langgraph-starter-kit
npm install
cp .env.example .env       # add your OPENAI_API_KEY
npm run dev                 # CLI demo — runs all 4 apps
npm run dev:http            # HTTP server at http://localhost:3000
```

---

## The Apps

### Swarm: Alice and Bob

Alice is an addition expert. Bob is a pirate who multiplies. They hand off to each other using tool calls.

```
User: "talk to bob then add 5 and 7"
  -> Alice transfers to Bob
  -> Bob responds (in pirate voice)
  -> Alice handles the addition
```

### Supervisor: Math + Writer

A supervisor agent reads the request and routes it to the right specialist — math problems go to `math_expert`, writing tasks go to `writer`.

### Interrupt: Database Admin

The `db_admin` agent can list and delete records. But `delete_record` calls `interrupt()` — the graph pauses and waits for a human to approve or reject the action.

### Analyst: Structured Output

The analyst agent takes text and returns a validated object:

```ts
{ title: string, keyPoints: string[], sentiment: "positive" | "negative" | "neutral" }
```

No string parsing needed — the output is type-safe via a Zod schema.

---

## Adding MCP Tools

Want to give your agents access to external tools without writing code?

```bash
cp mcp-servers.example.json mcp-servers.json
# Edit the file to add your MCP servers
# Set MCP_SERVERS_PATH=./mcp-servers.json in .env
```

MCP tools are loaded at startup, logged to the console, and automatically injected into the swarm and supervisor agents alongside their local tools.

---

## How Apps Are Built

Each app is a factory function that receives MCP tools:

```ts
// src/apps/supervisor.ts
export function createSupervisorApp(mcpTools: DynamicStructuredTool[] = []) {
  const math = makeAgent({
    name: "math_expert",
    llm,
    tools: [add, multiply, ...mcpTools],   // local + MCP tools
    system: "You are a math expert.",
  });

  const writer = makeAgent({ ... });

  return makeSupervisor({
    agents: [math, writer],
    llm,
  });
}
```

The server and CLI both:
1. Load MCP tools with `loadMcpTools()`
2. Pass them into the app factories
3. Register the built apps for routing

---

## HTTP Endpoints

All four apps share the same endpoint pattern:

```
POST /:app/invoke    — full response
POST /:app/stream    — SSE token stream
POST /:app/resume    — continue after interrupt
GET  /:app/threads/:id         — thread state
GET  /:app/threads/:id/history — full state history
GET  /health                   — status + loaded MCP tool count
```

Replace `:app` with `swarm`, `supervisor`, `interrupt`, or `analyst`.

---

## Next Steps

- Swap the toy tools (add, multiply, echo) for your own APIs
- Add more agents and wire them into new apps
- Configure MCP servers for external tool access
- Switch to PostgreSQL for production persistence
- Deploy with Docker Compose

See the main [README](../README.md) for full details on extending, persistence, and deployment.
