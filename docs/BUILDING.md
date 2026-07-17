# Building with the Starter Kit

This guide is for developers building their own agents on top of the kit. The
[README](../README.md) covers running the demos and the HTTP API; this covers
the agent layer itself — the APIs, the two composition patterns, and the rules
that aren't obvious until they bite you.

## Table of contents

- [Mental model](#mental-model)
- [Creating an agent: `makeAgent`](#creating-an-agent-makeagent)
- [Pattern 1: Subagents (supervisor)](#pattern-1-subagents-supervisor)
- [Pattern 2: Handoffs (swarm)](#pattern-2-handoffs-swarm)
- [Choosing a pattern](#choosing-a-pattern)
- [Checkpointers and interrupts — the rule that matters](#checkpointers-and-interrupts--the-rule-that-matters)
- [Structured output](#structured-output)
- [Persistence and threads](#persistence-and-threads)
- [Testing without an API key](#testing-without-an-api-key)
- [Wiring a new app into the kit](#wiring-a-new-app-into-the-kit)
- [MCP tools](#mcp-tools)

## Mental model

Everything in `src/apps/` is a factory (`createXxxApp()`) that returns a
**compiled LangGraph graph**. You interact with every app the same way:

```typescript
const app = await createMyApp();

const result = await app.invoke(
  { messages: [{ role: "user", content: "..." }] },
  { configurable: { thread_id: "some-thread" } }
);

result.messages.at(-1); // final answer
```

Agents are built with LangChain's `createAgent` (via the `makeAgent` wrapper).
Multi-agent apps compose them with one of two patterns:

- **Subagents** — a supervisor agent calls worker agents *as tools*
- **Handoffs** — peer agents are *graph nodes* that transfer control to each other

> **Why not `@langchain/langgraph-supervisor` / `-swarm`?** Those packages are
> no longer actively maintained upstream. The patterns here are the officially
> recommended replacements, built only on `langchain` and `@langchain/langgraph`.

Models come from the provider factory:

```typescript
import { getLlm } from "../config/llm";

const llm = await getLlm();                          // env-configured, shared instance
const cheap = await getLlm({ model: "gpt-4o-mini" }); // per-agent override
```

## Creating an agent: `makeAgent`

`src/agents/factory.ts`

```typescript
import { makeAgent } from "../agents/factory";

const agent = makeAgent({
  name: "researcher",          // used in traces and multi-agent wiring
  llm,                         // BaseChatModel from getLlm()
  tools: [webSearch],          // optional
  system: "You are ...",       // optional system prompt
  responseFormat: ...,         // optional, see Structured output
  checkpointer: ...,           // optional — ONLY for the outermost agent
});
```

A single agent with tools is a complete app — don't reach for a multi-agent
pattern until one agent with the right tools stops working. The `analyst`,
`rag`, and `interrupt` apps are all single agents.

## Pattern 1: Subagents (supervisor)

`src/agents/supervisor.ts` — used by the `supervisor`, `researcher`, and
`support` apps.

A **supervisor** agent coordinates workers by calling them as tools. Each
subagent is stateless and runs in an isolated context window; the supervisor
only ever sees the subagent's *final answer*, not its internal tool calls.
All conversation memory lives on the supervisor's thread.

```typescript
import { makeAgent } from "../agents/factory";
import { makeSupervisor } from "../agents/supervisor";

const math = makeAgent({ name: "math_expert", llm, tools: [add, multiply] });
const writer = makeAgent({ name: "writer", llm, tools: [] });

const app = await makeSupervisor({
  subagents: [
    {
      name: "math_expert",                             // tool name the supervisor calls
      description: "Delegate calculations to the math expert.", // when to call it
      agent: math,
    },
    {
      name: "writer",
      description: "Delegate writing. Include all facts the text should contain.",
      agent: writer,
    },
  ],
  llm,
  supervisorName: "supervisor",   // optional
  prompt: "...",                  // optional supervisor system prompt
  checkpointer,                   // optional — defaults to getCheckpointer()
});
```

Two details matter more than they look:

- **`description` is the routing logic.** The supervisor's model decides which
  subagent to call based purely on these descriptions. Vague descriptions =
  wrong routing.
- **Subagents only see the `task` string** the supervisor writes for them —
  not the conversation. If a subagent needs a fact (a customer ID, earlier
  findings), the supervisor must include it in the task. Nudge this in the
  supervisor `prompt` and the subagent `description` (see the `support` app).

If you need different context engineering — passing full history, trimming,
custom output — wrap the agent yourself with `subagentTool()` as a starting
point (it's exported from the same file).

## Pattern 2: Handoffs (swarm)

`src/agents/swarm.ts` + `src/agents/handoff.ts` — used by the `swarm` app.

Peer agents are **graph nodes**. A handoff tool transfers control: it flips a
checkpointed `activeAgent` state field and jumps to the target node. Unlike
subagents, every agent sees the full shared message history and talks to the
user directly. On the next turn of the same thread, the conversation resumes
with whichever agent last held it.

```typescript
import { makeAgent } from "../agents/factory";
import { createHandoffTool } from "../agents/handoff";
import { makeSwarm } from "../agents/swarm";

const alice = makeAgent({
  name: "alice",
  llm,
  tools: [add, createHandoffTool({ agentName: "bob" })],
  system: "You are Alice, an addition expert.",
});

const bob = makeAgent({
  name: "bob",
  llm,
  tools: [multiply, createHandoffTool({ agentName: "alice" })],
  system: "You are Bob, a multiplication expert.",
});

const app = await makeSwarm({
  agents: [
    { name: "alice", agent: alice },  // name must match createHandoffTool targets
    { name: "bob", agent: bob },
  ],
  defaultActiveAgent: "alice",
});
```

The handoff tool is exposed to the model as `transfer_to_<agentName>`. Under
the hood it returns a `Command` targeting the parent graph — it copies the
transferring agent's last AI message plus a `ToolMessage` into shared state so
the history stays well-formed, then routes to the target node.

## Choosing a pattern

| | Subagents | Handoffs |
|---|---|---|
| Control | Centralized — supervisor decides everything | Decentralized — agents transfer to each other |
| Context | Isolated per subagent (no bloat) | Shared history across agents |
| User interaction | Only the supervisor talks to the user | The active agent talks to the user |
| Memory across turns | Supervisor thread | `activeAgent` persists — conversation resumes with the last agent |
| Best for | Task delegation, distinct domains, workflows | Multi-stage conversations, escalation flows |

Rule of thumb: if the user should *converse* with different specialists, use
handoffs. If specialists just *do work* and report back, use subagents.

## Checkpointers and interrupts — the rule that matters

> **Only the outermost graph gets a checkpointer. Never give one to a
> subagent.**

Subagents inherit the parent's checkpointer at runtime. That inheritance is
exactly what lets `interrupt()` inside a subagent's tool pause the *entire*
graph and resume later. Give a subagent its own checkpointer and interrupts
break in a way that fails silently — the graph just doesn't pause.

`makeSupervisor` and `makeSwarm` already follow this rule (they checkpoint the
outer graph only). It becomes your problem when you compose agents manually.

The full HITL flow:

```typescript
// 1. A tool anywhere in the tree calls interrupt()
const decision = interrupt({ type: "approval_required", message: "Delete rec_2?" });
// (code after interrupt() runs on resume, with `decision` = the resume value)

// 2. Invoke returns with the graph paused. Inspect why:
const state = await app.getState({ configurable: { thread_id } });
state.next;                                          // non-empty = paused
state.tasks.flatMap((t) => t.interrupts ?? []);      // the interrupt payloads

// 3. Resume with the human's decision:
import { Command } from "@langchain/langgraph";
await app.invoke(new Command({ resume: "yes" }), { configurable: { thread_id } });
```

Over HTTP this is `POST /:app/invoke` → `POST /:app/resume` (see the README's
HITL section). Interrupts propagate through arbitrarily nested agent layers —
the `support` app raises them from tools two levels deep.

## Structured output

Pass a strategy-wrapped Zod schema as `responseFormat`; read the result from
`structuredResponse` on the final state (also returned by `POST /:app/invoke`):

```typescript
import { toolStrategy } from "langchain";

const app = makeAgent({
  name: "analyst",
  llm,
  system: "You analyze text.",
  responseFormat: toolStrategy(SummarySchema),  // works with every provider
  checkpointer: await getCheckpointer(),
});

const result = await app.invoke({ messages }, config);
(result as Record<string, unknown>).structuredResponse; // validated object
```

`toolStrategy` makes the model emit the schema as a tool call — reliable
across all five providers. If your model supports native structured output,
`providerStrategy` uses the provider's own API instead. Small local models
(3B) fumble schema tool calls regularly; this is a model limitation, not a
wiring problem.

## Persistence and threads

- Every `invoke` targets a thread: `{ configurable: { thread_id: "..." } }`.
  Same thread = same conversation memory. New thread = clean slate.
- **No `DATABASE_URL`** → `MemorySaver`: state lives in process memory and
  dies on restart.
- **`DATABASE_URL` set** → `PostgresSaver`: tables are auto-created on first
  run; threads (including paused HITL graphs) survive restarts. Requires the
  optional `@langchain/langgraph-checkpoint-postgres` dependency.

`GET /:app/threads/:id` and `GET /:app/threads/:id/history` expose thread
state over HTTP.

## Testing without an API key

`tests/helpers/scripted-model.ts` provides `ScriptedToolCallingModel` — a fake
model that replays a queued list of responses. Because it drives the *real*
graphs, you can test delegation chains, handoffs, and interrupt/resume flows
offline and deterministically. All agents sharing the instance consume the
queue in call order.

```typescript
import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { ScriptedToolCallingModel } from "../helpers/scripted-model";

const llm = new ScriptedToolCallingModel([
  // 1. supervisor delegates
  new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "math_expert", args: { task: "sum 10 and 15" } }] }),
  // 2. subagent calls its tool
  new AIMessage({ content: "", tool_calls: [{ id: "c2", name: "add", args: { a: 10, b: 15 } }] }),
  // 3. subagent answers
  new AIMessage("The sum is 25."),
  // 4. supervisor answers the user
  new AIMessage("Done: 25."),
]);

const app = await makeSupervisor({ subagents, llm, checkpointer: new MemorySaver() });
```

Pass an explicit `checkpointer` in tests — it keeps the test off the
env-configured checkpointer (and away from the API-key validation in
`config/env.ts`). See `tests/agents/supervisor.test.ts` (including an
interrupt/resume test) and `tests/agents/swarm.test.ts` for full examples.

## Wiring a new app into the kit

1. Create `src/apps/my-agent.ts` exporting `createMyApp()` (see the README's
   [Adding Your Own Agent](../README.md#adding-your-own-agent)).
2. Register it in `src/server/index.ts` — add one line to the `apps` map:
   ```typescript
   "my-agent": asApp(await createMyApp()),
   ```
   All routes (`/my-agent/invoke`, `/stream`, `/resume`, threads) work
   immediately.
3. Optionally add a demo in `src/index.ts` and a Studio entry in
   `langgraph.json`:
   ```json
   "my-agent": "./src/apps/my-agent.ts:createMyApp"
   ```
4. Add an offline test in `tests/` using `ScriptedToolCallingModel`.

## MCP tools

Tools loaded from MCP servers (`MCP_SERVERS_PATH`) arrive as regular LangChain
tools — pass them into any agent's `tools` array like the built-ins. The
`swarm` and `supervisor` apps accept them as a parameter:

```typescript
const { tools: mcpTools } = await loadMcpTools();
const app = await createSupervisorApp(mcpTools);
```
