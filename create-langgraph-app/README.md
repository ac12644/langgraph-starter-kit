# create-langgraph-app

Interactive CLI to scaffold a new LangGraph multi-agent project in seconds.

## Usage

```bash
npx create-langgraph-app
```

## What it does

1. Asks for your project name
2. Lets you pick an LLM provider (OpenAI, Anthropic, Google, Groq, Ollama)
3. Lets you select which agent patterns to include:
   - **Supervisor** — central coordinator + worker agents
   - **Swarm** — peer-to-peer agent handoffs
   - **Human-in-the-Loop** — approval before dangerous actions
   - **Structured Output** — typed JSON responses
   - **RAG** — retrieval-augmented generation
4. Generates a ready-to-run project with only the patterns you selected
5. Installs dependencies

## Development

```bash
cd create-langgraph-app
npm install
npm run dev  # Run locally
```

## Publishing

```bash
cd create-langgraph-app
npm run build
npm publish
```
