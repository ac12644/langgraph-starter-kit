import "./config/env";
import { Command } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import { loadMcpTools } from "./tools/mcp";
import { createSwarmApp } from "./apps/swarm";
import { createSupervisorApp } from "./apps/supervisor";
import { createInterruptApp } from "./apps/interrupt";
import { createAnalystApp } from "./apps/analyst";
import { createResearcherApp } from "./apps/researcher";
import { createRagApp, initRagStore } from "./apps/rag";
import { createSupportApp } from "./apps/support";

function lastContent(messages: BaseMessage[]): string {
  const last = messages.at(-1);
  if (!last) return "(no response)";
  return typeof last.content === "string" ? last.content : JSON.stringify(last.content);
}

interface TaskState {
  next?: string[];
  tasks?: Array<{ interrupts?: Array<{ value?: Record<string, unknown> }> }>;
}

async function runDemo(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${name} failed: ${msg}`);
  }
}

async function run(): Promise<void> {
  const { tools: mcpTools } = await loadMcpTools();

  const swarmApp = createSwarmApp(mcpTools);
  const supervisorApp = createSupervisorApp(mcpTools);
  const interruptApp = createInterruptApp();
  const analystApp = createAnalystApp();
  const researcherApp = createResearcherApp();
  const supportApp = createSupportApp();
  const ragStore = await initRagStore();
  const ragApp = createRagApp(ragStore);

  // -- Supervisor --
  await runDemo("Supervisor Demo", async () => {
    const result = await supervisorApp.invoke(
      { messages: [{ role: "user", content: "sum 10 and 15, then write a one-line summary" }] },
      { configurable: { thread_id: "supervisor-demo" } }
    );
    console.log("supervisor:", lastContent(result.messages));
  });

  // -- Swarm --
  await runDemo("Swarm Demo", async () => {
    const result = await swarmApp.invoke(
      { messages: [{ role: "user", content: "add 5 and 7" }] },
      { configurable: { thread_id: "swarm-demo" } }
    );
    console.log("swarm:", lastContent(result.messages));
  });

  // -- Structured Output --
  await runDemo("Structured Output Demo", async () => {
    const result = await analystApp.invoke(
      {
        messages: [{
          role: "user",
          content: "Analyze: Our Q4 revenue grew 25% YoY, but customer churn increased by 8%.",
        }],
      },
      { configurable: { thread_id: "analyst-demo" } }
    );
    console.log("analyst:", lastContent(result.messages));
  });

  // -- RAG --
  await runDemo("RAG Demo", async () => {
    const result = await ragApp.invoke(
      {
        messages: [{
          role: "user",
          content: "What is the supervisor pattern and how does it differ from swarm?",
        }],
      },
      { configurable: { thread_id: "rag-demo" } }
    );
    console.log("rag:", lastContent(result.messages));
  });

  // -- Research Agent --
  await runDemo("Research Agent Demo", async () => {
    const result = await researcherApp.invoke(
      {
        messages: [{
          role: "user",
          content: "Research the latest developments in LangGraph and multi-agent systems. Give me a brief summary.",
        }],
      },
      { configurable: { thread_id: "research-demo" } }
    );
    console.log("researcher:", lastContent(result.messages));
  });

  // -- Customer Support --
  await runDemo("Customer Support Demo", async () => {
    const result = await supportApp.invoke(
      {
        messages: [{
          role: "user",
          content: "Hi, I'm customer C-1002. I was charged $29.99 but I thought my plan was free. Can you check my balance and help me get a refund?",
        }],
      },
      { configurable: { thread_id: "support-demo" } }
    );
    console.log("support:", lastContent(result.messages));
  });

  // -- Human-in-the-Loop --
  await runDemo("Human-in-the-Loop Demo", async () => {
    const hitlCfg = { configurable: { thread_id: "hitl-demo" } };

    await interruptApp.invoke(
      { messages: [{ role: "user", content: "delete record rec_2" }] },
      hitlCfg
    );

    const state = await interruptApp.getState(hitlCfg) as TaskState;
    const pendingSteps = state.next ?? [];

    if (pendingSteps.length > 0) {
      console.log("interrupt: Graph paused, waiting for approval...");

      const interrupts = (state.tasks ?? []).flatMap((t) => t.interrupts ?? []);
      for (const i of interrupts) {
        const detail = i.value?.message ?? JSON.stringify(i.value);
        console.log("interrupt: Approval needed:", detail);
      }

      console.log('interrupt: Approving with "yes"...');
      const resumed = await interruptApp.invoke(
        new Command({ resume: "yes" }),
        hitlCfg
      );
      console.log("interrupt:", lastContent(resumed.messages));
    }
  });
}

run().catch((err: unknown) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
