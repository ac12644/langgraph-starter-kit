# create-langgraph-app

Interactive CLI to scaffold a new LangGraph multi-agent project in seconds.

```bash
npx create-langgraph-app
```

## What it does

1. Asks for your project name
2. Lets you pick an LLM provider — OpenAI, Anthropic, Google, Groq, DeepSeek, or Ollama
3. Lets you select which agent patterns to include:
   - **Supervisor** — central coordinator delegating to worker agents
   - **Swarm** — peer-to-peer agent handoffs
   - **Human-in-the-Loop** — approval before dangerous actions
   - **Structured Output** — typed JSON responses validated by Zod
   - **RAG** — retrieval-augmented generation over an in-memory vector store
4. Generates a ready-to-run project containing only the patterns you picked
5. Installs dependencies

## What you get

```
src/
├── config/      env validation, LLM factory, embeddings (with RAG)
├── agents/      makeAgent() and the helpers your patterns need
├── apps/        one file per selected pattern
├── tools/       retrieval tool + vector store (with RAG)
├── server.ts    Fastify server — invoke, stream, resume, threads
└── index.ts     CLI demo running each pattern
tests/           offline tests that need no API key
```

Everything is built on LangChain's `createAgent` — the **subagents** pattern for
supervisors, **handoffs** for swarms. No deprecated packages.

## RAG and embeddings

Selecting RAG generates a working implementation: chunking, embedding,
cosine-similarity search, and a retrieval tool the agent calls before answering.
Swap `SAMPLE_DOCS` in `src/tools/rag.ts` for your own documents.

Embeddings are a separate capability from chat. OpenAI, Google and Ollama have
their own; **Anthropic, Groq and DeepSeek do not**, so those projects use OpenAI
embeddings and need `OPENAI_API_KEY` in addition to the chat provider's key. The
generated `.env` says so, and `EMBEDDINGS_MODEL` overrides the model.

To run RAG with no API key at all, scaffold with Ollama.

If embeddings are unavailable, only RAG is affected — the other patterns and
routes keep working, and the server logs why `/rag` is disabled.

## Development

```bash
cd create-langgraph-app
npm install
npm run dev      # run the CLI locally
npm run build    # typecheck and emit dist/
```

Generated projects are compiled in CI, so a change that breaks the output fails
the build. See `tests/scaffolder/` in the [starter kit](https://github.com/ac12644/langgraph-starter-kit).

## Releasing

Publishing is automated. Bump the version in `package.json`, then push a
matching `cli-v*` tag:

```bash
git tag -a cli-v1.5.0 -m "create-langgraph-app v1.5.0"
git push origin cli-v1.5.0
```

The `Publish CLI to npm` workflow builds and publishes with provenance.
