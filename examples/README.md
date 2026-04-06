# Examples

Real-world agent apps built on the starter kit. Each example shows how to compose agents, tools, and patterns for a specific use case.

| Example | What it demonstrates | Patterns used |
|---|---|---|
| [Customer Support Bot](./customer-support/) | Multi-agent routing, billing/tech/returns specialists, human escalation | Supervisor, HITL |
| [Research Agent](./research-agent/) | Web search + URL scraping, coordinated research and writing | Supervisor |
| [RAG Agent](./rag-agent/) | Document indexing, vector search, retrieval-augmented answers | Supervisor, RAG |

## How examples work

Each example has:
- An **app file** in `src/apps/` that composes the agents
- **Tool files** in `src/tools/` with the domain-specific tools
- A **README** explaining the architecture and how to use it
- **Tests** in `tests/`

All examples are automatically registered in the HTTP server and CLI demo. Run any example with:

```bash
# Via HTTP
curl -X POST http://localhost:3000/{app-name}/invoke \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "your message"}]}'

# Via CLI demo
npm run dev
```

## Adding your own example

See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-new-agent-pattern) for a step-by-step guide.
