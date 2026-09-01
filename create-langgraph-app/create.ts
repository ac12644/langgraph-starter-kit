#!/usr/bin/env node

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// ── Helpers ──────────────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function banner() {
  console.log(`
${BOLD}${CYAN}  ╔═══════════════════════════════════════╗
  ║     create-langgraph-app              ║
  ║     Multi-agent starter in seconds    ║
  ╚═══════════════════════════════════════╝${RESET}
`);
}

async function ask(
  rl: readline.Interface,
  question: string,
  defaultVal?: string
): Promise<string> {
  const suffix = defaultVal ? ` ${DIM}(${defaultVal})${RESET}` : "";
  const answer = await rl.question(`${BOLD}${question}${suffix}: ${RESET}`);
  return answer.trim() || defaultVal || "";
}

async function choose(
  rl: readline.Interface,
  question: string,
  options: { value: string; label: string }[],
  multi = false
): Promise<string[]> {
  console.log(`\n${BOLD}${question}${RESET}`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${DIM}${i + 1}.${RESET} ${options[i].label}`);
  }

  if (multi) {
    const answer = await rl.question(
      `${DIM}Enter numbers separated by commas (e.g. 1,2,3): ${RESET}`
    );
    const indices = answer
      .split(",")
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((i) => i >= 0 && i < options.length);
    return indices.length > 0
      ? indices.map((i) => options[i].value)
      : options.map((o) => o.value);
  } else {
    const answer = await rl.question(`${DIM}Enter number: ${RESET}`);
    const idx = parseInt(answer.trim(), 10) - 1;
    return [options[idx]?.value ?? options[0].value];
  }
}

// ── Templates ────────────────────────────────────────────────────────────────

const PROVIDERS: Record<string, { envKey: string; defaultModel: string }> = {
  openai: { envKey: "OPENAI_API_KEY", defaultModel: "gpt-4o-mini" },
  anthropic: { envKey: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-4-20250514" },
  google: { envKey: "GOOGLE_API_KEY", defaultModel: "gemini-2.0-flash" },
  groq: { envKey: "GROQ_API_KEY", defaultModel: "llama-3.3-70b-versatile" },
  ollama: { envKey: "", defaultModel: "llama3.2" },
  deepseek: { envKey: "DEEPSEEK_API_KEY", defaultModel: "deepseek-v4-flash" },
};

export interface Config {
  name: string;
  provider: string;
  patterns: string[];
}

export function generateEnv(config: Config): string {
  const prov = PROVIDERS[config.provider];
  const lines = [
    `# LLM Provider`,
    `LLM_PROVIDER=${config.provider}`,
    ``,
    `# API key`,
  ];
  if (prov.envKey) {
    lines.push(`${prov.envKey}=`);
  } else {
    lines.push(`# No API key needed for ${config.provider}`);
  }
  lines.push(
    ``,
    `# Model (optional — defaults to ${prov.defaultModel})`,
    `# LLM_MODEL=${prov.defaultModel}`,
    `LLM_TEMPERATURE=0`,
    ``,
    ...(config.patterns.includes("rag") &&
    (EMBEDDINGS_FOR_PROVIDER[config.provider] ?? "openai") !== config.provider
      ? [
          `# RAG embeddings: ${config.provider} has no embeddings API, so RAG uses`,
          `# ${EMBEDDINGS_FOR_PROVIDER[config.provider] ?? "openai"} and needs its key as well.`,
          `${PROVIDER_EMBEDDINGS[EMBEDDINGS_FOR_PROVIDER[config.provider] ?? "openai"].envKey}=`,
          `# EMBEDDINGS_MODEL=${PROVIDER_EMBEDDINGS[EMBEDDINGS_FOR_PROVIDER[config.provider] ?? "openai"].defaultModel}`,
          ``,
        ]
      : []),
    ...(config.provider === "deepseek"
      ? [`# DeepSeek reasoning mode (optional — "disabled" | "enabled")`, `# DEEPSEEK_THINKING=disabled`, ``]
      : []),
    `PORT=3000`,
    ``,
    `# LangSmith tracing (optional)`,
    `# LANGCHAIN_TRACING_V2=true`,
    `# LANGSMITH_API_KEY=`,
    `# LANGSMITH_PROJECT=${config.name}`,
  );
  return lines.join("\n") + "\n";
}

export function generatePackageJson(config: Config): string {
  const deps: Record<string, string> = {
    "@langchain/core": "^1.2.3",
    "@langchain/langgraph": "^1.4.8",
    "@langchain/mcp-adapters": "^1.1.3",
    dotenv: "^17.4.2",
    fastify: "^5.10.0",
    langchain: "^1.5.3",
    zod: "^4.4.3",
  };

  if (config.patterns.includes("rag")) {
    deps["@langchain/textsplitters"] = "^1.0.1";
  }

  // Provider package
  const provPkg: Record<string, string> = {
    openai: "@langchain/openai",
    anthropic: "@langchain/anthropic",
    google: "@langchain/google-genai",
    groq: "@langchain/groq",
    ollama: "@langchain/ollama",
    deepseek: "@langchain/deepseek",
  };
  deps[provPkg[config.provider]] = "latest";

  // RAG needs an embeddings SDK, which is a different package when the chat
  // provider has no embeddings API of its own (anthropic, groq, deepseek).
  if (config.patterns.includes("rag")) {
    const embPkg = PROVIDER_EMBEDDINGS[EMBEDDINGS_FOR_PROVIDER[config.provider] ?? "openai"].pkg;
    if (!deps[embPkg]) deps[embPkg] = "latest";
  }

  const pkg = {
    name: config.name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "tsx src/index.ts",
      "dev:http": "tsx src/server.ts",
      test: "vitest run",
      "test:watch": "vitest",
      typecheck: "tsc --noEmit",
    },
    dependencies: Object.fromEntries(
      Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))
    ),
    devDependencies: {
      "@types/node": "^25.9.1",
      tsx: "^4.22.4",
      typescript: "^6.0.3",
      vitest: "^4.1.8",
    },
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}

export function generateTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        types: ["node"],
        outDir: "dist",
      },
      include: ["src", "tests"],
    },
    null,
    2
  ) + "\n";
}

function generateEnvConfig(config: Config): string {
  return `import "dotenv/config";

const VALID_PROVIDERS = ["openai", "anthropic", "google", "groq", "ollama", "deepseek"] as const;
export type LlmProvider = (typeof VALID_PROVIDERS)[number];

function resolveProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER || "openai").toLowerCase();
  if (!VALID_PROVIDERS.includes(raw as LlmProvider)) {
    throw new Error(\`Invalid LLM_PROVIDER "\${raw}". Must be one of: \${VALID_PROVIDERS.join(", ")}\`);
  }
  return raw as LlmProvider;
}

const API_KEY_MAP: Record<LlmProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  groq: "GROQ_API_KEY",
  ollama: "",
  deepseek: "DEEPSEEK_API_KEY",
};

export const LLM_PROVIDER = resolveProvider();

// Fail fast: validate the selected provider's key at startup.
const requiredKey = API_KEY_MAP[LLM_PROVIDER];
if (requiredKey && !process.env[requiredKey]) {
  throw new Error(\`\${requiredKey} is required for provider "\${LLM_PROVIDER}" but not set in .env\`);
}

export const LLM_MODEL = process.env.LLM_MODEL || undefined;
export const LLM_TEMPERATURE = Number(process.env.LLM_TEMPERATURE ?? 0);
// Uses || rather than ?? so an empty DEEPSEEK_THINKING= in .env falls back
// to "disabled" instead of sending an invalid thinking type to the API.
export const DEEPSEEK_THINKING = process.env.DEEPSEEK_THINKING || "disabled";
export const PORT = Number(process.env.PORT ?? 3000);
`;
}

// Per-provider class + constructor shape. The generated llm.ts only imports the
// provider that was selected, so the scaffold depends on a single LLM SDK.
const PROVIDER_LLM: Record<
  string,
  { pkg: string; className: string; modelArg: "model" | "modelName"; defaultModel: string; extraArgs?: string }
> = {
  openai: { pkg: "@langchain/openai", className: "ChatOpenAI", modelArg: "modelName", defaultModel: "gpt-4o-mini" },
  anthropic: { pkg: "@langchain/anthropic", className: "ChatAnthropic", modelArg: "modelName", defaultModel: "claude-sonnet-4-20250514" },
  google: { pkg: "@langchain/google-genai", className: "ChatGoogleGenerativeAI", modelArg: "model", defaultModel: "gemini-2.0-flash" },
  groq: { pkg: "@langchain/groq", className: "ChatGroq", modelArg: "model", defaultModel: "llama-3.3-70b-versatile" },
  ollama: { pkg: "@langchain/ollama", className: "ChatOllama", modelArg: "model", defaultModel: "llama3.2" },
  deepseek: { pkg: "@langchain/deepseek", className: "ChatDeepSeek", modelArg: "model", defaultModel: "deepseek-v4-flash", extraArgs: 'modelKwargs: { thinking: { type: DEEPSEEK_THINKING } }' },
};

// Which provider supplies embeddings for a given chat provider. Anthropic, Groq
// and DeepSeek have no embeddings API, so they fall back to OpenAI's.
const EMBEDDINGS_FOR_PROVIDER: Record<string, "openai" | "google" | "ollama"> = {
  openai: "openai",
  anthropic: "openai",
  google: "google",
  groq: "openai",
  ollama: "ollama",
  deepseek: "openai",
};

const PROVIDER_EMBEDDINGS: Record<
  string,
  { pkg: string; className: string; defaultModel: string; envKey: string }
> = {
  openai: { pkg: "@langchain/openai", className: "OpenAIEmbeddings", defaultModel: "text-embedding-3-small", envKey: "OPENAI_API_KEY" },
  google: { pkg: "@langchain/google-genai", className: "GoogleGenerativeAIEmbeddings", defaultModel: "text-embedding-004", envKey: "GOOGLE_API_KEY" },
  ollama: { pkg: "@langchain/ollama", className: "OllamaEmbeddings", defaultModel: "nomic-embed-text", envKey: "" },
};

/**
 * The scaffold installs one embeddings SDK — the one for the provider resolved
 * at generation time — so the generated config imports only that SDK. Switching
 * EMBEDDINGS_PROVIDER later means installing the matching package and adding a
 * branch here.
 */
function generateEmbeddingsConfig(config: Config): string {
  const providerId = EMBEDDINGS_FOR_PROVIDER[config.provider] ?? "openai";
  const e = PROVIDER_EMBEDDINGS[providerId];
  const fellBack = providerId !== config.provider;

  return `import type { Embeddings } from "@langchain/core/embeddings";
import { ${e.className} } from "${e.pkg}";

const PROVIDER = "${providerId}";
const DEFAULT_MODEL = "${e.defaultModel}";
${e.envKey ? `const REQUIRED_KEY = "${e.envKey}";` : `const REQUIRED_KEY = "";`}
${fellBack ? `
// ${config.provider} has no embeddings API, so embeddings use ${providerId}.
// That means RAG needs ${e.envKey} in addition to your chat provider's key.
// Set EMBEDDINGS_MODEL to override the model.` : ""}

/**
 * Builds the embeddings client for RAG.
 *
 * Validation happens here rather than at import time: a project that never uses
 * RAG should not need an embeddings key, and an eager throw would take down
 * every route rather than just the RAG one.
 */
export async function createEmbeddings(modelOverride?: string): Promise<Embeddings> {
  const requested = process.env.EMBEDDINGS_PROVIDER?.trim().toLowerCase();
  if (requested && requested !== PROVIDER) {
    throw new Error(
      \`EMBEDDINGS_PROVIDER="\${requested}" but this project was scaffolded with "\${PROVIDER}" embeddings. \` +
        \`Install the matching SDK and add a branch in src/config/embeddings.ts.\`
    );
  }

  if (REQUIRED_KEY && !process.env[REQUIRED_KEY]) {
    throw new Error(\`\${REQUIRED_KEY} is required for "\${PROVIDER}" embeddings but is not set in .env\`);
  }

  const model = modelOverride ?? process.env.EMBEDDINGS_MODEL?.trim() ?? DEFAULT_MODEL;
  return new ${e.className}({ model });
}
`;
}

function generateLlmConfig(config: Config): string {
  const p = PROVIDER_LLM[config.provider] ?? PROVIDER_LLM.openai;
  const envImports =
    config.provider === "deepseek"
      ? "LLM_MODEL, LLM_TEMPERATURE, DEEPSEEK_THINKING"
      : "LLM_MODEL, LLM_TEMPERATURE";
  return `import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ${envImports} } from "./env";

const DEFAULT_MODEL = "${p.defaultModel}";

export interface LlmOptions {
  model?: string;
  temperature?: number;
}

async function createLlm(opts: LlmOptions = {}): Promise<BaseChatModel> {
  const model = opts.model ?? LLM_MODEL ?? DEFAULT_MODEL;
  const temperature = opts.temperature ?? LLM_TEMPERATURE;

  const { ${p.className} } = await import("${p.pkg}");
  return new ${p.className}({ ${p.modelArg}: model, temperature${p.extraArgs ? `, ${p.extraArgs}` : ""} });
}

let _default: Promise<BaseChatModel> | undefined;

/**
 * Returns a chat model.
 *
 * Called with no options it returns a memoized, shared instance (nothing is
 * constructed until first use). Pass options to build a distinct model, e.g. a
 * cheap router and a strong worker:
 *
 *   const router = await getLlm({ model: "${p.defaultModel}" });
 *   const worker = await getLlm({ model: "<a-stronger-model>" });
 */
export function getLlm(opts?: LlmOptions): Promise<BaseChatModel> {
  if (!opts || Object.keys(opts).length === 0) {
    _default ??= createLlm();
    return _default;
  }
  return createLlm(opts);
}
`;
}

function generateAgentFactory(): string {
  return `import { createAgent, type ResponseFormat, type TypedToolStrategy } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

type CreateAgentParams = Parameters<typeof createAgent>[0];

export interface MakeAgentParams {
  name: string;
  llm: BaseChatModel;
  tools?: CreateAgentParams["tools"];
  system?: string;
  responseFormat?: ResponseFormat | TypedToolStrategy<Record<string, unknown>>;
  /**
   * Only the outermost agent of a multi-agent setup should get a
   * checkpointer — subagents inherit it at runtime, which is what lets
   * interrupt() calls bubble up to the top-level graph.
   */
  checkpointer?: BaseCheckpointSaver;
}

/** Wraps LangChain's createAgent with a simpler interface. */
export function makeAgent({
  name,
  llm,
  tools = [],
  system,
  responseFormat,
  checkpointer,
}: MakeAgentParams) {
  return createAgent({
    name,
    model: llm,
    tools,
    ...(system ? { systemPrompt: system } : {}),
    ...(responseFormat ? { responseFormat } : {}),
    ...(checkpointer ? { checkpointer } : {}),
  });
}

export type AgentGraph = ReturnType<typeof makeAgent>;
`;
}

function generateSupervisorHelper(): string {
  return `import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { MemorySaver } from "@langchain/langgraph";
import { makeAgent, type AgentGraph } from "./factory";

/**
 * Supervisor via the "subagents" pattern: a main agent coordinates workers
 * by calling them as tools. Subagents are stateless and run in isolated
 * context windows; only the supervisor gets a checkpointer, so interrupt()
 * inside a subagent tool pauses the whole graph.
 */

export interface SubagentSpec {
  /** Tool name the supervisor calls, e.g. "math_expert". */
  name: string;
  /** Tells the supervisor's model when to delegate to this agent. */
  description: string;
  agent: AgentGraph;
}

/** Wraps a compiled agent as a tool the supervisor can call. */
export function subagentTool({ name, description, agent }: SubagentSpec) {
  return tool(
    async ({ task }) => {
      const result = await agent.invoke({
        messages: [{ role: "user", content: task }],
      });
      const last = result.messages.at(-1);
      if (!last) return "(no response)";
      return typeof last.content === "string"
        ? last.content
        : JSON.stringify(last.content);
    },
    {
      name,
      description,
      schema: z.object({
        task: z
          .string()
          .describe("A self-contained task with all context the agent needs"),
      }),
    }
  );
}

export interface MakeSupervisorParams {
  subagents: SubagentSpec[];
  llm: BaseChatModel;
  supervisorName?: string;
  prompt?: string;
  checkpointer?: BaseCheckpointSaver;
}

export function makeSupervisor({
  subagents,
  llm,
  supervisorName = "supervisor",
  prompt,
  checkpointer,
}: MakeSupervisorParams) {
  const defaultPrompt =
    "You coordinate a team of specialists. Delegate work to them via " +
    \`your tools (\${subagents.map((s) => s.name).join(", ")}) and answer \` +
    "the user only once the delegated work is done.";

  return makeAgent({
    name: supervisorName,
    llm,
    tools: subagents.map(subagentTool),
    system: prompt ?? defaultPrompt,
    checkpointer: checkpointer ?? new MemorySaver(),
  });
}
`;
}

// Maps a selected pattern to the app it generates, so the server and demos
// only reference files that actually exist.
const PATTERN_APPS: Record<string, { route: string; fn: string; path: string }> = {
  supervisor: { route: "supervisor", fn: "createSupervisorApp", path: "./apps/supervisor" },
  swarm: { route: "swarm", fn: "createSwarmApp", path: "./apps/swarm" },
  hitl: { route: "interrupt", fn: "createInterruptApp", path: "./apps/interrupt" },
  structured: { route: "analyst", fn: "createAnalystApp", path: "./apps/analyst" },
  rag: { route: "rag", fn: "createRagApp", path: "./apps/rag" },
};

function selectedApps(config: Config) {
  return config.patterns.map((p) => PATTERN_APPS[p]).filter(Boolean);
}

function generateServer(config: Config): string {
  const apps = selectedApps(config);
  const imports = apps.map((a) => `import { ${a.fn} } from "${a.path}";`).join("\n");
  const entries = apps
    .filter((a) => a.route !== "rag")
    .map((a) => `    "${a.route}": asApp(await ${a.fn}()),`)
    .join("\n");

  // RAG is the one app that can fail at startup: it needs an embeddings
  // provider, and providers without one fall back to another provider's key.
  // Build it in a try/catch so a missing key costs /rag, not every route.
  const ragInit = apps.some((a) => a.route === "rag")
    ? `  let ragApp: AppGraph | undefined;
  try {
    ragApp = asApp(await createRagApp());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(\`RAG app unavailable (embeddings failed): \${msg}\`);
    console.warn("  /rag routes are disabled; every other app still works.");
  }

`
    : "";
  const ragEntry = apps.some((a) => a.route === "rag")
    ? `\n    ...(ragApp ? { rag: ragApp } : {}),`
    : "";

  return `import "./config/env";
import { fastify, type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import { Command } from "@langchain/langgraph";
import { AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { PORT } from "./config/env";
${imports}

// The apps are a mix of agents and graphs whose generic types don't unify;
// this is the structural slice the routes actually need.
interface AppGraph {
  invoke(input: unknown, config?: unknown): Promise<{ messages: BaseMessage[] } & Record<string, unknown>>;
  stream(input: unknown, config?: unknown): Promise<AsyncIterable<[unknown, { langgraph_node?: string } | undefined]>>;
  getState(config: unknown): Promise<{ values?: unknown; next?: string[]; tasks?: unknown[] } | undefined>;
}
const asApp = (g: unknown) => g as AppGraph;

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { statusCode: status });
}

/** Reject malformed bodies before they reach the agent. */
function validateMessages(raw: unknown): { role: string; content: string }[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw httpError(400, '"messages" must be an array');
  return raw.map((m, i) => {
    const { role, content } = (m ?? {}) as Record<string, unknown>;
    if (typeof role !== "string" || typeof content !== "string") {
      throw httpError(400, \`messages[\${i}] needs string "role" and "content"\`);
    }
    return { role, content };
  });
}

const server = fastify({ logger: false });

server.setErrorHandler(async (error: FastifyError, _req: FastifyRequest, reply: FastifyReply) => {
  const status = error.statusCode ?? 500;
  return reply.status(status).send({ error: error.message });
});

async function start() {
${ragInit}  const apps: Record<string, AppGraph> = {
${entries}${ragEntry}
  };

  const getApp = (name: string) => {
    const app = apps[name];
    if (!app) throw httpError(404, \`Unknown app: "\${name}". Available: \${Object.keys(apps).join(", ")}\`);
    return app;
  };

  server.post<{ Params: { app: string } }>("/:app/invoke", async (req, reply) => {
    const app = getApp(req.params.app);
    const body = (req.body ?? {}) as { messages?: unknown; thread_id?: string };
    const messages = validateMessages(body.messages);
    const thread_id = body.thread_id ?? "default";

    const result = await app.invoke({ messages }, { configurable: { thread_id } });
    const last = result.messages.at(-1);
    return reply.send({
      messages: result.messages,
      structuredResponse: (result as Record<string, unknown>).structuredResponse ?? null,
      lastMessage: typeof last?.content === "string" ? last.content : JSON.stringify(last?.content),
    });
  });

  server.post<{ Params: { app: string } }>("/:app/stream", async (req, reply) => {
    const app = getApp(req.params.app);
    const body = (req.body ?? {}) as { messages?: unknown; thread_id?: string };
    const messages = validateMessages(body.messages);
    const thread_id = body.thread_id ?? "default";

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (e: unknown) => reply.raw.write(\`data: \${JSON.stringify(e)}\\n\\n\`);

    try {
      const stream = await app.stream({ messages }, { configurable: { thread_id }, streamMode: "messages" });
      for await (const [chunk, metadata] of stream) {
        if (chunk instanceof AIMessageChunk) {
          send({ type: "token", content: chunk.content, node: metadata?.langgraph_node ?? "unknown" });
        }
      }
      send({ type: "done" });
    } catch (err) {
      send({ type: "error", content: err instanceof Error ? err.message : "Stream failed" });
    } finally {
      reply.raw.end();
    }
  });

  server.post<{ Params: { app: string } }>("/:app/resume", async (req, reply) => {
    const app = getApp(req.params.app);
    const body = (req.body ?? {}) as { thread_id?: string; decision?: string };
    if (body.decision === undefined) {
      return reply.status(400).send({ error: '"decision" field is required' });
    }
    const result = await app.invoke(new Command({ resume: body.decision }), {
      configurable: { thread_id: body.thread_id ?? "default" },
    });
    const last = result.messages.at(-1);
    return reply.send({
      messages: result.messages,
      lastMessage: typeof last?.content === "string" ? last.content : JSON.stringify(last?.content),
    });
  });

  server.get<{ Params: { app: string; threadId: string } }>("/:app/threads/:threadId", async (req, reply) => {
    const app = getApp(req.params.app);
    const state = await app.getState({ configurable: { thread_id: req.params.threadId } });
    if (!state?.values) return reply.status(404).send({ error: "Thread not found" });
    return reply.send({ values: state.values, next: state.next ?? [], tasks: state.tasks ?? [] });
  });

  server.get("/health", async () => ({ status: "ok", apps: Object.keys(apps) }));

  // Container runtimes send SIGTERM on stop — drain instead of dying mid-request.
  let shuttingDown = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      server.close().then(() => process.exit(0)).catch(() => process.exit(1));
    });
  }

  await server.listen({ port: PORT, host: "0.0.0.0" });
  console.log(\`Server running at http://localhost:\${PORT}\`);
  console.log(\`Apps: \${Object.keys(apps).join(", ")}\`);
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
`;
}

function generateScriptedModel(): string {
  return `import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

/**
 * A model that replays a queued list of responses, so tests can drive real
 * graphs offline — no API key, no network, fully deterministic.
 */
export class ScriptedToolCallingModel extends BaseChatModel {
  private queue: AIMessage[];

  constructor(queue: AIMessage[]) {
    super({});
    this.queue = [...queue];
  }

  _llmType(): string {
    return "scripted-tool-calling";
  }

  override bindTools(): this {
    return this;
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    const message = this.queue.shift();
    if (!message) throw new Error("Scripted model ran out of responses");
    return { generations: [{ message, text: "" }] };
  }
}
`;
}

function generateAgentTest(config: Config): string {
  const hasSupervisor = config.patterns.includes("supervisor");

  const supervisorTest = hasSupervisor
    ? `
  it("delegates to a subagent and returns its answer", async () => {
    const llm = new ScriptedToolCallingModel([
      // supervisor delegates
      new AIMessage({
        content: "",
        tool_calls: [{ id: "c1", name: "worker", args: { task: "do the thing" } }],
      }),
      // subagent answers
      new AIMessage("worker done"),
      // supervisor wraps up
      new AIMessage("All finished."),
    ]);

    const worker = makeAgent({ name: "worker", llm, tools: [] });
    const app = await makeSupervisor({
      subagents: [{ name: "worker", description: "Does the thing.", agent: worker }],
      llm,
      checkpointer: new MemorySaver(),
    });

    const result = await app.invoke(
      { messages: [{ role: "user", content: "do the thing" }] },
      { configurable: { thread_id: "t1" } }
    );

    expect(result.messages.at(-1)?.content).toBe("All finished.");
    // the supervisor sees the subagent's final answer, not its internals
    const toolMessages = result.messages.filter((m) => m.getType() === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].content).toBe("worker done");
  });
`
    : "";

  const supervisorImports = hasSupervisor
    ? `import { makeSupervisor } from "../src/agents/supervisor";\nimport { MemorySaver } from "@langchain/langgraph";\n`
    : "";

  return `import { describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { makeAgent } from "../src/agents/factory";
${supervisorImports}import { ScriptedToolCallingModel } from "./helpers/scripted-model";

describe("agents", () => {
  it("runs a single agent to a final answer", async () => {
    const llm = new ScriptedToolCallingModel([new AIMessage("Hello there.")]);
    const agent = makeAgent({ name: "assistant", llm, tools: [], system: "Be brief." });

    const result = await agent.invoke({ messages: [{ role: "user", content: "hi" }] });

    expect(result.messages.at(-1)?.content).toBe("Hello there.");
  });
${supervisorTest}});
`;
}

// Pattern-specific: only files for selected patterns are generated
export function getPatternFiles(
  config: Config
): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];

  // Always include core files
  files.push({ path: "src/config/env.ts", content: generateEnvConfig(config) });
  files.push({ path: "src/config/llm.ts", content: generateLlmConfig(config) });
  files.push({ path: "src/agents/factory.ts", content: generateAgentFactory() });
  files.push({ path: "src/agents/supervisor.ts", content: generateSupervisorHelper() });

  // Index file — imports vary by selected patterns
  const imports: string[] = [];
  const demos: string[] = [];

  if (config.patterns.includes("supervisor")) {
    files.push({
      path: "src/apps/supervisor.ts",
      content: `import { getLlm } from "../config/llm";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { makeAgent } from "../agents/factory";
import { makeSupervisor } from "../agents/supervisor";

const add = tool(async ({ a, b }) => String(a + b), {
  name: "add", description: "Add two numbers",
  schema: z.object({ a: z.number(), b: z.number() }),
});

export async function createSupervisorApp() {
  const llm = await getLlm();

  const math = makeAgent({
    name: "math_expert", llm,
    tools: [add],
    system: "You are a math expert.",
  });

  const writer = makeAgent({
    name: "writer", llm, tools: [],
    system: "You write crisp, structured answers.",
  });

  return makeSupervisor({
    subagents: [
      { name: "math_expert", description: "Delegate calculations to the math expert.", agent: math },
      { name: "writer", description: "Delegate writing. Include all facts the text should contain.", agent: writer },
    ],
    llm,
    supervisorName: "supervisor",
  });
}
`,
    });
    imports.push(`import { createSupervisorApp } from "./apps/supervisor";`);
    demos.push(`  console.log("=== Supervisor Demo ===");
  const supervisorApp = await createSupervisorApp();
  const sup = await supervisorApp.invoke(
    { messages: [{ role: "user", content: "What is 10 + 15?" }] },
    { configurable: { thread_id: "demo" } }
  );
  console.log("Result:", sup.messages.at(-1)?.content);`);
  }

  if (config.patterns.includes("swarm")) {
    files.push({
      path: "src/agents/swarm.ts",
      content: `import { z } from "zod";
import { AIMessage } from "@langchain/core/messages";
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  MemorySaver,
  START,
  END,
} from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { AgentGraph } from "./factory";

/**
 * Swarm via the "handoffs" pattern: each agent is a graph node, and handoff
 * tools (see ./handoff.ts) jump between nodes while flipping activeAgent.
 * activeAgent is checkpointed, so the conversation resumes with whichever
 * agent last held it.
 */

export const SwarmState = new StateSchema({
  messages: MessagesValue,
  activeAgent: z.string().optional(),
});

export type SwarmStateType = typeof SwarmState.State;

export interface SwarmAgentSpec {
  /** Node name; handoff tools reference it as transfer_to_<name>. */
  name: string;
  agent: AgentGraph;
}

export interface MakeSwarmParams {
  agents: SwarmAgentSpec[];
  defaultActiveAgent: string;
  checkpointer?: BaseCheckpointSaver;
}

export function makeSwarm({
  agents,
  defaultActiveAgent,
  checkpointer,
}: MakeSwarmParams) {
  const names = agents.map((a) => a.name);

  const routeToActive = (state: SwarmStateType) =>
    state.activeAgent ?? defaultActiveAgent;

  // After an agent runs: done if it answered (no pending tool calls);
  // otherwise a handoff moved activeAgent, so continue there.
  const routeAfterAgent = (state: SwarmStateType) => {
    const last = state.messages.at(-1);
    if (last && AIMessage.isInstance(last) && !last.tool_calls?.length) {
      return END;
    }
    return state.activeAgent ?? defaultActiveAgent;
  };

  // Node names are only known at runtime, so the graph is built with
  // string keys and the routers are cast to the node-name union.
  let builder = new StateGraph(SwarmState) as StateGraph<
    typeof SwarmState,
    SwarmStateType
  >;
  for (const { name, agent } of agents) {
    builder = builder.addNode(name, async (state: SwarmStateType) =>
      agent.invoke(state)
    ) as typeof builder;
  }

  builder.addConditionalEdges(START, routeToActive as never, names as never);
  for (const name of names) {
    builder.addConditionalEdges(
      name as never,
      routeAfterAgent as never,
      [...names, END] as never
    );
  }

  return builder.compile({
    checkpointer: checkpointer ?? new MemorySaver(),
  });
}
`,
    });
    files.push({
      path: "src/agents/handoff.ts",
      content: `import { z } from "zod";
import { tool, type ToolRuntime } from "@langchain/core/tools";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { SwarmStateType } from "./swarm";

/**
 * Handoff tool for the handoffs pattern. Returns a Command targeting the
 * PARENT graph: it flips activeAgent and jumps to the target agent's node.
 * The calling agent's last AI message (the one containing this tool call)
 * plus a ToolMessage are copied into parent state so the conversation
 * history stays well-formed.
 */
export function createHandoffTool({ agentName, description }: { agentName: string; description?: string }) {
  return tool(
    async (_, runtime: ToolRuntime<SwarmStateType>) => {
      const lastAiMessage = [...(runtime.state.messages ?? [])]
        .reverse()
        .find(AIMessage.isInstance);
      const transferMessage = new ToolMessage({
        content: \`Transferred to \${agentName}\`,
        tool_call_id: runtime.toolCallId ?? "",
      });
      return new Command({
        goto: agentName,
        update: {
          activeAgent: agentName,
          messages: [lastAiMessage, transferMessage].filter(Boolean),
        },
        graph: Command.PARENT,
      });
    },
    {
      name: \`transfer_to_\${agentName}\`,
      description: description ?? \`Transfer the conversation to \${agentName}.\`,
      schema: z.object({}),
    }
  );
}
`,
    });
    files.push({
      path: "src/apps/swarm.ts",
      content: `import { getLlm } from "../config/llm";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { makeAgent } from "../agents/factory";
import { createHandoffTool } from "../agents/handoff";
import { makeSwarm } from "../agents/swarm";

const add = tool(async ({ a, b }) => String(a + b), {
  name: "add", description: "Add two numbers",
  schema: z.object({ a: z.number(), b: z.number() }),
});

const multiply = tool(async ({ a, b }) => String(a * b), {
  name: "multiply", description: "Multiply two numbers",
  schema: z.object({ a: z.number(), b: z.number() }),
});

export async function createSwarmApp() {
  const llm = await getLlm();

  const alice = makeAgent({
    name: "alice", llm,
    tools: [add, createHandoffTool({ agentName: "bob" })],
    system: "You are Alice, an addition expert.",
  });

  const bob = makeAgent({
    name: "bob", llm,
    tools: [multiply, createHandoffTool({ agentName: "alice" })],
    system: "You are Bob, a multiplication expert.",
  });

  return makeSwarm({
    agents: [
      { name: "alice", agent: alice },
      { name: "bob", agent: bob },
    ],
    defaultActiveAgent: "alice",
  });
}
`,
    });
    imports.push(`import { createSwarmApp } from "./apps/swarm";`);
    demos.push(`  console.log("\\n=== Swarm Demo ===");
  const swarmApp = await createSwarmApp();
  const swarm = await swarmApp.invoke(
    { messages: [{ role: "user", content: "add 5 and 7, then talk to bob and multiply by 3" }] },
    { configurable: { thread_id: "swarm-demo" } }
  );
  console.log("Result:", swarm.messages.at(-1)?.content);`);
  }

  if (config.patterns.includes("hitl")) {
    files.push({
      path: "src/apps/interrupt.ts",
      content: `import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { interrupt, MemorySaver } from "@langchain/langgraph";
import { getLlm } from "../config/llm";
import { makeAgent } from "../agents/factory";

const deleteRecord = tool(
  async (args) => {
    const decision = interrupt({
      type: "approval_required",
      message: \`Delete record "\${args.id}"? This cannot be undone.\`,
      args,
    });
    return decision === "yes"
      ? \`Record "\${args.id}" deleted.\`
      : \`Deletion of "\${args.id}" rejected.\`;
  },
  {
    name: "delete_record",
    description: "Delete a record by ID. Requires human approval.",
    schema: z.object({ id: z.string() }),
  }
);

export async function createInterruptApp() {
  const llm = await getLlm();

  // A single agent with a checkpointer — interrupt() inside delete_record
  // pauses the graph; resume with Command({ resume: "yes" }) on the thread.
  return makeAgent({
    name: "db_admin", llm,
    tools: [deleteRecord],
    system: "You are a database administrator.",
    checkpointer: new MemorySaver(),
  });
}
`,
    });
    imports.push(`import { Command } from "@langchain/langgraph";`);
    imports.push(`import { createInterruptApp } from "./apps/interrupt";`);
    demos.push(`  console.log("\\n=== Human-in-the-Loop Demo ===");
  const interruptApp = await createInterruptApp();
  const hitlCfg = { configurable: { thread_id: "hitl-demo" } };
  await interruptApp.invoke(
    { messages: [{ role: "user", content: "delete record rec_2" }] },
    hitlCfg
  );
  const state = await interruptApp.getState(hitlCfg) as any;
  if ((state.next ?? []).length > 0) {
    console.log("Graph paused — approving...");
    const resumed = await interruptApp.invoke(new Command({ resume: "yes" }), hitlCfg);
    console.log("Result:", resumed.messages.at(-1)?.content);
  }`);
  }

  if (config.patterns.includes("structured")) {
    files.push({
      path: "src/apps/analyst.ts",
      content: `import { z } from "zod";
import { toolStrategy } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { getLlm } from "../config/llm";
import { makeAgent } from "../agents/factory";

const SummarySchema = z.object({
  title: z.string(),
  keyPoints: z.array(z.string()),
  sentiment: z.enum(["positive", "negative", "neutral"]),
});

export async function createAnalystApp() {
  const llm = await getLlm();

  // The structured result is returned on the structuredResponse key of the
  // final state. toolStrategy works with every provider; models with native
  // structured output support could use providerStrategy instead.
  return makeAgent({
    name: "analyst", llm, tools: [],
    system: "Analyze text and produce structured summaries.",
    responseFormat: toolStrategy(SummarySchema),
    checkpointer: new MemorySaver(),
  });
}
`,
    });
    imports.push(`import { createAnalystApp } from "./apps/analyst";`);
    demos.push(`  console.log("\\n=== Structured Output Demo ===");
  const analystApp = await createAnalystApp();
  const analysis = await analystApp.invoke(
    { messages: [{ role: "user", content: "Analyze: Revenue grew 25% but churn increased 8%." }] },
    { configurable: { thread_id: "analyst-demo" } }
  );
  const structured = (analysis as Record<string, unknown>).structuredResponse;
  console.log("Result:", JSON.stringify(structured ?? analysis.messages.at(-1)?.content));`);
  }

  if (config.patterns.includes("rag")) {
    files.push({ path: "src/config/embeddings.ts", content: generateEmbeddingsConfig(config) });
    files.push({
      path: "src/tools/rag.ts",
      content: `import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { Embeddings } from "@langchain/core/embeddings";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

/** In-memory vector store — no external database required. */
export interface InMemoryVectorStore {
  size: number;
  search: (query: string, k?: number) => Promise<string[]>;
}

interface Chunk {
  content: string;
  embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  // Guard the zero vector: without this an empty embedding yields NaN and
  // silently corrupts the ranking.
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function buildVectorStore(
  embeddings: Embeddings,
  documents: string[],
  chunkSize = 500,
  chunkOverlap = 100,
): Promise<InMemoryVectorStore> {
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });
  const docs = await splitter.createDocuments(documents);
  const texts = docs.map((d) => d.pageContent);
  const vectors = await embeddings.embedDocuments(texts);
  const chunks: Chunk[] = texts.map((content, i) => ({ content, embedding: vectors[i] }));

  return {
    size: chunks.length,
    search: async (query: string, k = 4) => {
      if (chunks.length === 0) return [];
      const queryVector = await embeddings.embedQuery(query);
      return chunks
        .map((c) => ({ content: c.content, score: cosineSimilarity(queryVector, c.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map((c) => c.content);
    },
  };
}

export function createRetrievalTool(vectorStore: InMemoryVectorStore) {
  return tool(
    async ({ query, k }) => {
      const results = await vectorStore.search(query, k);
      if (results.length === 0) return "No relevant documents found. Try rephrasing.";
      return results.map((r, i) => "[" + (i + 1) + "] " + r).join("\\n\\n");
    },
    {
      name: "search_knowledge_base",
      description:
        "Search the knowledge base for relevant information. Use this to find context before answering.",
      schema: z.object({
        query: z.string().describe("The search query"),
        k: z.number().optional().default(4).describe("Number of results to return"),
      }),
    }
  );
}

/** Replace these with your own documents. */
export const SAMPLE_DOCS = [
  "LangGraph is a framework for building stateful, multi-actor applications with LLMs. It uses a graph architecture where nodes are computational steps and edges define the flow between them. Key features include persistence via checkpointing, streaming, and human-in-the-loop workflows.",
  "The supervisor pattern uses a central coordinator that routes tasks to specialized worker agents and aggregates their results. Workers are stateless and run in isolated context windows, so the supervisor only sees each worker's final answer.",
  "The swarm pattern lets peer agents hand off control to each other with transfer tools. Each agent is a graph node, and the active agent persists across turns, so a conversation resumes with whichever agent last held it.",
];
`,
    });
    files.push({
      path: "src/apps/rag.ts",
      content: `import { MemorySaver } from "@langchain/langgraph";
import { getLlm } from "../config/llm";
import { createEmbeddings } from "../config/embeddings";
import { makeAgent } from "../agents/factory";
import {
  buildVectorStore,
  createRetrievalTool,
  SAMPLE_DOCS,
  type InMemoryVectorStore,
} from "../tools/rag";

let _vectorStore: InMemoryVectorStore | null = null;

/** Indexes the documents once; later calls reuse the same store. */
export async function initRagStore(documents: string[] = SAMPLE_DOCS): Promise<InMemoryVectorStore> {
  if (!_vectorStore) {
    const embeddings = await createEmbeddings();
    _vectorStore = await buildVectorStore(embeddings, documents);
    console.log("RAG: indexed " + _vectorStore.size + " chunks");
  }
  return _vectorStore;
}

export async function createRagApp(vectorStore?: InMemoryVectorStore) {
  const llm = await getLlm();
  const retrievalTool = createRetrievalTool(vectorStore ?? (await initRagStore()));

  return makeAgent({
    name: "rag_agent",
    llm,
    tools: [retrievalTool],
    system: [
      "You are a knowledgeable assistant with access to a knowledge base.",
      "ALWAYS search the knowledge base before answering questions.",
      "Base your answers on the retrieved documents. If they do not contain",
      "the answer, say so clearly rather than guessing.",
    ].join("\\n"),
    checkpointer: new MemorySaver(),
  });
}
`,
    });
    imports.push(`import { createRagApp } from "./apps/rag";`);
    demos.push(`  console.log("\\n=== RAG Demo ===");
  const ragApp = await createRagApp();
  const rag = await ragApp.invoke(
    { messages: [{ role: "user", content: "What is the supervisor pattern?" }] },
    { configurable: { thread_id: "rag-demo" } }
  );
  console.log("Result:", rag.messages.at(-1)?.content);`);
  }

  // HTTP server — routes only the apps that were generated
  files.push({ path: "src/server.ts", content: generateServer(config) });

  // Tests — offline, no API key needed
  files.push({ path: "tests/helpers/scripted-model.ts", content: generateScriptedModel() });
  files.push({ path: "tests/agents.test.ts", content: generateAgentTest(config) });

  // Generate index.ts
  files.push({
    path: "src/index.ts",
    content: `import "./config/env";
${imports.join("\n")}

async function main() {
${demos.join("\n\n")}
}

main().catch((err) => { console.error(err); process.exit(1); });
`,
  });

  return files;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner();

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const name = await ask(rl, "Project name", "my-langgraph-app");

    const [provider] = await choose(rl, "LLM provider?", [
      { value: "openai", label: "OpenAI (gpt-4o-mini)" },
      { value: "anthropic", label: "Anthropic (Claude Sonnet)" },
      { value: "google", label: "Google (Gemini 2.0 Flash)" },
      { value: "groq", label: "Groq (Llama 3.3 70B)" },
      { value: "deepseek", label: "DeepSeek (deepseek-v4-flash)" },
      { value: "ollama", label: "Ollama (local, no API key)" },
    ]);

    const patterns = await choose(
      rl,
      "Which patterns? (select multiple)",
      [
        { value: "supervisor", label: "Supervisor — central coordinator + worker agents" },
        { value: "swarm", label: "Swarm — peer-to-peer agent handoffs" },
        { value: "hitl", label: "Human-in-the-Loop — approval before dangerous actions" },
        { value: "structured", label: "Structured Output — typed JSON responses" },
        { value: "rag", label: "RAG — retrieval-augmented generation" },
      ],
      true
    );

    const config: Config = { name, provider, patterns };

    // Create project directory
    const projectDir = path.resolve(process.cwd(), name);
    if (fs.existsSync(projectDir)) {
      console.log(`\n${YELLOW}Directory "${name}" already exists. Aborting.${RESET}`);
      process.exit(1);
    }

    console.log(`\n${DIM}Creating project...${RESET}`);
    fs.mkdirSync(projectDir, { recursive: true });

    // Write config files
    const filesToWrite = [
      { path: "package.json", content: generatePackageJson(config) },
      { path: "tsconfig.json", content: generateTsConfig() },
      { path: ".env", content: generateEnv(config) },
      { path: ".env.example", content: generateEnv(config) },
      { path: ".gitignore", content: "node_modules\ndist\n.env\n" },
      ...getPatternFiles(config),
    ];

    for (const file of filesToWrite) {
      const fullPath = path.join(projectDir, file.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content);
    }

    // Install dependencies
    console.log(`${DIM}Installing dependencies...${RESET}\n`);
    execSync("npm install", { cwd: projectDir, stdio: "inherit" });

    // Done!
    console.log(`
${GREEN}${BOLD}Done!${RESET} Your project is ready.

  ${CYAN}cd ${name}${RESET}
  ${DIM}# Add your API key to .env${RESET}
  ${CYAN}npm run dev${RESET}

${DIM}Patterns: ${patterns.join(", ")}
Provider: ${provider}${RESET}
`);
  } finally {
    rl.close();
  }
}

// Only run the interactive CLI when executed directly. Importing this module
// (e.g. from the scaffolder tests) must not prompt.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
