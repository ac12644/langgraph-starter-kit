# Examples

Runnable scenarios built on the starter kit. Each one is a single file you can
execute, showing a complete use case end to end.

They import the apps from `src/` rather than copying them, so there is no second
copy to drift — what you run here is the same code the server and demo use.

| Example | Run it | What it shows that `npm run dev` doesn't |
|---|---|---|
| [RAG Agent](./rag-agent/) | `npm run example:rag` | Indexing **your own documents** instead of the samples, and what a grounded refusal looks like |
| [Customer Support](./customer-support/) | `npm run example:support` | A **multi-turn** conversation on one thread, plus pausing for human approval and resuming |
| [Research Agent](./research-agent/) | `npm run example:research "your topic"` | **Streaming** tokens as they arrive, and handling reasoning models that emit mostly thinking tokens |

Each needs the same `.env` as the rest of the kit. With Ollama they run with no
API key at all.

> **Slow local models:** these are multi-step agents, and a small local model can
> take minutes per step. If a run dies with `UND_ERR_HEADERS_TIMEOUT`, a single
> model call exceeded the HTTP client's 300s default — use a faster model or a
> hosted provider rather than assuming the example is broken.

## How examples work

Each example has:
- A runnable **`index.ts`** in `examples/<name>/` — the scenario itself
- An **app file** in `src/apps/` that composes the agents
- **Tool files** in `src/tools/` with the domain-specific tools
- A **README** explaining the architecture
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
