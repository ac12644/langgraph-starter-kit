# Contributing to LangGraph Starter Kit

First off — thank you for considering contributing! Whether it's a bug fix, new agent pattern, documentation improvement, or just a typo fix, every contribution makes this project better for everyone.

## Ways to Contribute

There's no contribution too small. Here are some ideas:

**No code required:**
- Star the repo (it helps a lot!)
- Report bugs or suggest features via [Issues](https://github.com/ac12644/langgraph-starter-kit/issues)
- Improve documentation or fix typos
- Write a blog post or tutorial about using the starter kit
- Share the project in your community

**Code contributions:**
- Add a new agent pattern (e.g., customer support, coding assistant)
- Add support for a new LLM provider
- Add new tools (calculators, APIs, databases)
- Improve test coverage
- Fix bugs

**For first-time contributors:**
Look for issues labeled [`good first issue`](https://github.com/ac12644/langgraph-starter-kit/labels/good%20first%20issue) — these are specifically designed to be approachable.

## Getting Started

```bash
# 1. Fork the repo on GitHub

# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/langgraph-starter-kit.git
cd langgraph-starter-kit

# 3. Install dependencies
npm install

# 4. Set up your environment
cp .env.example .env
# Add your API key to .env

# 5. Make sure everything works
npm test
npm run typecheck
```

## Development Workflow

```bash
npm run dev          # Run CLI demo
npm run dev:http     # Run HTTP server on port 3000
npm test             # Run tests
npm run test:watch   # Run tests in watch mode
npm run typecheck    # Type check
```

## Adding a New Agent Pattern

This is the most impactful type of contribution. Here's the process:

1. **Create your app** in `src/apps/your-pattern.ts`
   - Use `makeAgent()` from `src/agents/factory.ts` to create agents
   - Use `makeSupervisor()` or `makeSwarm()` to compose them
   - Export a `createYourApp()` factory function

2. **Add any new tools** in `src/tools/`

3. **Register it** in both:
   - `src/server/index.ts` (HTTP routes)
   - `src/index.ts` (CLI demo)
   - `langgraph.json` (LangGraph Studio)

4. **Add tests** in `tests/`

5. **Update the README** with a description and curl example

Here's the minimal template:

```typescript
// src/apps/my-agent.ts
import { llm } from "../config/llm";
import { makeAgent } from "../agents/factory";
import { makeSupervisor } from "../agents/supervisor";

export function createMyApp() {
  const agent = makeAgent({
    name: "my_agent",
    llm,
    tools: [/* your tools */],
    system: "You are a helpful assistant.",
  });

  return makeSupervisor({
    agents: [agent],
    llm,
    outputMode: "last_message",
    supervisorName: "my_supervisor",
  });
}
```

## Adding a New LLM Provider

1. Install the LangChain provider package: `npm install @langchain/your-provider`
2. Add the provider case in `src/config/llm.ts`
3. Add the API key mapping in `src/config/env.ts`
4. Update `.env.example` with the new key
5. Update the provider table in `README.md`

## Pull Request Guidelines

- **Keep PRs focused** — one feature or fix per PR
- **Add tests** for new functionality
- **Make sure CI passes** — `npm test` and `npm run typecheck`
- **Write clear commit messages** that explain *why*, not just *what*
- **Update docs** if your change affects the public API or user-facing behavior

Don't worry about making things perfect — we'll work together during review to get it right.

## Code Style

- TypeScript strict mode
- Prefer simplicity over abstraction
- No comments for obvious code; add comments where the *why* isn't clear
- Use descriptive variable names

## Reporting Bugs

Open a [bug report](https://github.com/ac12644/langgraph-starter-kit/issues/new?template=bug_report.yml) with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (Node.js version, OS, LLM provider)

## Community

- Questions? Open a [Discussion](https://github.com/ac12644/langgraph-starter-kit/discussions)
- Found this useful? Star the repo and share it!

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
