#!/usr/bin/env node

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

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
};

interface Config {
  name: string;
  provider: string;
  patterns: string[];
}

function generateEnv(config: Config): string {
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
    `PORT=3000`,
    ``,
    `# LangSmith tracing (optional)`,
    `# LANGCHAIN_TRACING_V2=true`,
    `# LANGSMITH_API_KEY=`,
    `# LANGSMITH_PROJECT=${config.name}`,
  );
  return lines.join("\n") + "\n";
}

function generatePackageJson(config: Config): string {
  const deps: Record<string, string> = {
    "@langchain/core": "^1.1.39",
    "@langchain/langgraph": "^1.2.7",
    "@langchain/langgraph-supervisor": "^1.0.1",
    "@langchain/mcp-adapters": "^1.1.3",
    dotenv: "^17.4.0",
    fastify: "^5.8.4",
    langchain: "^1.3.0",
    zod: "^4.3.6",
  };

  if (config.patterns.includes("swarm")) {
    deps["@langchain/langgraph-swarm"] = "^1.0.1";
  }
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
  };
  deps[provPkg[config.provider]] = "latest";

  const pkg = {
    name: config.name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "tsx src/index.ts",
      "dev:http": "tsx src/server.ts",
      test: "vitest run",
      typecheck: "tsc --noEmit",
    },
    dependencies: Object.fromEntries(
      Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))
    ),
    devDependencies: {
      "@types/node": "^25.5.2",
      tsx: "^4.21.0",
      typescript: "^6.0.2",
      vitest: "^4.1.2",
    },
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}

function generateTsConfig(): string {
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
      include: ["src"],
    },
    null,
    2
  ) + "\n";
}

function generateEnvConfig(config: Config): string {
  return `import "dotenv/config";

const VALID_PROVIDERS = ["openai", "anthropic", "google", "groq", "ollama"] as const;
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
};

export const LLM_PROVIDER = resolveProvider();

const requiredKey = API_KEY_MAP[LLM_PROVIDER];
if (requiredKey && !process.env[requiredKey]) {
  throw new Error(\`\${requiredKey} is required for provider "\${LLM_PROVIDER}" but not set in .env\`);
}

export const LLM_MODEL = process.env.LLM_MODEL || undefined;
export const LLM_TEMPERATURE = Number(process.env.LLM_TEMPERATURE ?? 0);
export const PORT = Number(process.env.PORT ?? 3000);
`;
}

function generateLlmConfig(): string {
  return `import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { LLM_PROVIDER, LLM_MODEL, LLM_TEMPERATURE } from "./env";

const DEFAULTS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  ollama: "llama3.2",
};

function createLlm(): BaseChatModel {
  const model = LLM_MODEL ?? DEFAULTS[LLM_PROVIDER] ?? DEFAULTS.openai;
  const temperature = LLM_TEMPERATURE;

  switch (LLM_PROVIDER) {
    case "anthropic": {
      const { ChatAnthropic } = require("@langchain/anthropic");
      return new ChatAnthropic({ modelName: model, temperature });
    }
    case "google": {
      const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
      return new ChatGoogleGenerativeAI({ modelName: model, temperature });
    }
    case "groq": {
      const { ChatGroq } = require("@langchain/groq");
      return new ChatGroq({ modelName: model, temperature });
    }
    case "ollama": {
      const { ChatOllama } = require("@langchain/ollama");
      return new ChatOllama({ model, temperature });
    }
    default: {
      const { ChatOpenAI } = require("@langchain/openai");
      return new ChatOpenAI({ modelName: model, temperature });
    }
  }
}

export const llm = createLlm();
`;
}

function generateAgentFactory(): string {
  return `import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createReactAgent, type CreateReactAgentParams } from "@langchain/langgraph/prebuilt";

export interface MakeAgentParams {
  name: string;
  llm: BaseChatModel;
  tools?: StructuredToolInterface[];
  system?: string;
  responseFormat?: CreateReactAgentParams["responseFormat"];
}

export function makeAgent({ name, llm, tools = [], system, responseFormat }: MakeAgentParams) {
  return createReactAgent({
    name,
    llm,
    tools,
    ...(system ? { prompt: system } : {}),
    ...(responseFormat ? { responseFormat } : {}),
  });
}
`;
}

function generateSupervisorHelper(): string {
  return `import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph-checkpoint";
import { createSupervisor } from "@langchain/langgraph-supervisor";
import { MemorySaver, InMemoryStore } from "@langchain/langgraph";

type SupervisorParams = Parameters<typeof createSupervisor>[0];

export interface MakeSupervisorParams extends SupervisorParams {
  checkpointer?: BaseCheckpointSaver;
  store?: BaseStore;
}

export function makeSupervisor({ checkpointer, store, ...params }: MakeSupervisorParams) {
  return createSupervisor(params).compile({
    checkpointer: checkpointer ?? new MemorySaver(),
    store: store ?? new InMemoryStore(),
  });
}
`;
}

function generateSupervisorApp(): string {
  return `import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { llm } from "./config/env";
import { makeAgent } from "./agents/factory";
import { makeSupervisor } from "./agents/supervisor";

const add = tool(async ({ a, b }) => String(a + b), {
  name: "add", description: "Add two numbers",
  schema: z.object({ a: z.number(), b: z.number() }),
});

const multiply = tool(async ({ a, b }) => String(a * b), {
  name: "multiply", description: "Multiply two numbers",
  schema: z.object({ a: z.number(), b: z.number() }),
});

export function createApp() {
  const math = makeAgent({
    name: "math_expert", llm,
    tools: [add, multiply],
    system: "You are a math expert. Use tools to compute answers.",
  });

  const writer = makeAgent({
    name: "writer", llm, tools: [],
    system: "You write crisp, structured answers.",
  });

  return makeSupervisor({
    agents: [math, writer], llm,
    outputMode: "last_message",
    supervisorName: "supervisor",
  });
}
`;
}

// Pattern-specific: only files for selected patterns are generated
function getPatternFiles(
  config: Config
): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];

  // Always include core files
  files.push({ path: "src/config/env.ts", content: generateEnvConfig(config) });
  files.push({ path: "src/config/llm.ts", content: generateLlmConfig() });
  files.push({ path: "src/agents/factory.ts", content: generateAgentFactory() });
  files.push({ path: "src/agents/supervisor.ts", content: generateSupervisorHelper() });

  // Index file — imports vary by selected patterns
  const imports: string[] = [];
  const demos: string[] = [];

  if (config.patterns.includes("supervisor")) {
    files.push({
      path: "src/apps/supervisor.ts",
      content: `import { llm } from "../config/llm";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { makeAgent } from "../agents/factory";
import { makeSupervisor } from "../agents/supervisor";

const add = tool(async ({ a, b }) => String(a + b), {
  name: "add", description: "Add two numbers",
  schema: z.object({ a: z.number(), b: z.number() }),
});

export function createSupervisorApp() {
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
    agents: [math, writer], llm,
    outputMode: "last_message",
    supervisorName: "supervisor",
  });
}
`,
    });
    imports.push(`import { createSupervisorApp } from "./apps/supervisor";`);
    demos.push(`  console.log("=== Supervisor Demo ===");
  const supervisorApp = createSupervisorApp();
  const sup = await supervisorApp.invoke(
    { messages: [{ role: "user", content: "What is 10 + 15?" }] },
    { configurable: { thread_id: "demo" } }
  );
  console.log("Result:", sup.messages.at(-1)?.content);`);
  }

  if (config.patterns.includes("swarm")) {
    files.push({
      path: "src/agents/swarm.ts",
      content: `import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph-checkpoint";
import { MessagesAnnotation, Annotation, MemorySaver } from "@langchain/langgraph";
import { createSwarm } from "@langchain/langgraph-swarm";

export const SwarmState = Annotation.Root({
  ...MessagesAnnotation.spec,
  activeAgent: Annotation<string>(),
});

type SwarmParams = Parameters<typeof createSwarm>[0];

export function makeSwarm({
  agents, defaultActiveAgent, checkpointer,
}: {
  agents: SwarmParams["agents"];
  defaultActiveAgent: string;
  checkpointer?: BaseCheckpointSaver;
  store?: BaseStore;
}) {
  return createSwarm({ agents, defaultActiveAgent, stateSchema: SwarmState })
    .compile({ checkpointer: checkpointer ?? new MemorySaver() });
}
`,
    });
    files.push({
      path: "src/agents/handoff.ts",
      content: `import { z } from "zod";
import { ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Command, MessagesAnnotation, getCurrentTaskInput } from "@langchain/langgraph";

export function createHandoffTool({ agentName, description }: { agentName: string; description?: string }) {
  const toolName = \`transfer_to_\${agentName.replace(/\\s+/g, "_").toLowerCase()}\`;

  return tool(
    async (_args, cfg) => {
      const state = getCurrentTaskInput() as (typeof MessagesAnnotation)["State"];
      const messages = state.messages ?? [];
      const tm = new ToolMessage({
        content: \`Transferred to \${agentName}\`,
        name: toolName,
        tool_call_id: cfg.toolCall.id,
      });
      return new Command({
        goto: agentName,
        graph: Command.PARENT,
        update: { messages: messages.concat(tm), activeAgent: agentName },
      });
    },
    { name: toolName, description: description ?? \`Ask \${agentName} for help\`, schema: z.object({}) }
  );
}
`,
    });
    files.push({
      path: "src/apps/swarm.ts",
      content: `import { llm } from "../config/llm";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { makeAgent } from "../agents/factory";
import { createHandoffTool } from "../agents/handoff";
import { makeSwarm, type SwarmState } from "../agents/swarm";

const add = tool(async ({ a, b }) => String(a + b), {
  name: "add", description: "Add two numbers",
  schema: z.object({ a: z.number(), b: z.number() }),
});

const multiply = tool(async ({ a, b }) => String(a * b), {
  name: "multiply", description: "Multiply two numbers",
  schema: z.object({ a: z.number(), b: z.number() }),
});

export function createSwarmApp() {
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
    agents: [alice, bob] as any,
    defaultActiveAgent: "alice",
  });
}
`,
    });
    imports.push(`import { createSwarmApp } from "./apps/swarm";`);
    demos.push(`  console.log("\\n=== Swarm Demo ===");
  const swarmApp = createSwarmApp();
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
import { interrupt } from "@langchain/langgraph";
import { llm } from "../config/llm";
import { makeAgent } from "../agents/factory";
import { makeSupervisor } from "../agents/supervisor";

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

export function createInterruptApp() {
  const dbAdmin = makeAgent({
    name: "db_admin", llm,
    tools: [deleteRecord],
    system: "You are a database administrator.",
  });

  return makeSupervisor({
    agents: [dbAdmin], llm,
    outputMode: "last_message",
    supervisorName: "interrupt_supervisor",
  });
}
`,
    });
    imports.push(`import { Command } from "@langchain/langgraph";`);
    imports.push(`import { createInterruptApp } from "./apps/interrupt";`);
    demos.push(`  console.log("\\n=== Human-in-the-Loop Demo ===");
  const interruptApp = createInterruptApp();
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
import { llm } from "../config/llm";
import { makeAgent } from "../agents/factory";
import { makeSupervisor } from "../agents/supervisor";

const SummarySchema = z.object({
  title: z.string(),
  keyPoints: z.array(z.string()),
  sentiment: z.enum(["positive", "negative", "neutral"]),
});

export function createAnalystApp() {
  const analyst = makeAgent({
    name: "analyst", llm, tools: [],
    system: "Analyze text and produce structured summaries.",
    responseFormat: SummarySchema,
  });

  return makeSupervisor({
    agents: [analyst], llm,
    outputMode: "last_message",
    supervisorName: "analyst_supervisor",
  });
}
`,
    });
    imports.push(`import { createAnalystApp } from "./apps/analyst";`);
    demos.push(`  console.log("\\n=== Structured Output Demo ===");
  const analystApp = createAnalystApp();
  const analysis = await analystApp.invoke(
    { messages: [{ role: "user", content: "Analyze: Revenue grew 25% but churn increased 8%." }] },
    { configurable: { thread_id: "analyst-demo" } }
  );
  console.log("Result:", analysis.messages.at(-1)?.content);`);
  }

  if (config.patterns.includes("rag")) {
    files.push({
      path: "src/apps/rag.ts",
      content: `import { llm } from "../config/llm";
import { makeAgent } from "../agents/factory";
import { makeSupervisor } from "../agents/supervisor";
// TODO: Add your vector store, embeddings, and retrieval tool here.
// See the full starter kit for a complete RAG implementation:
// https://github.com/ac12644/langgraph-starter-kit

export function createRagApp() {
  const ragAgent = makeAgent({
    name: "rag_agent", llm, tools: [],
    system: "You are a knowledgeable assistant. Answer questions based on your knowledge.",
  });

  return makeSupervisor({
    agents: [ragAgent], llm,
    outputMode: "last_message",
    supervisorName: "rag_supervisor",
  });
}
`,
    });
    imports.push(`import { createRagApp } from "./apps/rag";`);
    demos.push(`  console.log("\\n=== RAG Demo ===");
  const ragApp = createRagApp();
  const rag = await ragApp.invoke(
    { messages: [{ role: "user", content: "What is RAG and how does it work?" }] },
    { configurable: { thread_id: "rag-demo" } }
  );
  console.log("Result:", rag.messages.at(-1)?.content);`);
  }

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

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
