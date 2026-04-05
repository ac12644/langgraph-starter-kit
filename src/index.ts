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

function lastContent(messages: BaseMessage[]): string {
  const last = messages.at(-1);
  if (!last) return "(no response)";
  return typeof last.content === "string" ? last.content : JSON.stringify(last.content);
}

interface TaskState {
  next?: string[];
  tasks?: Array<{ interrupts?: Array<{ value?: Record<string, unknown> }> }>;
}

async function run(): Promise<void> {
  // Load MCP tools and inject into agents
  const { tools: mcpTools } = await loadMcpTools();

  const swarmApp = createSwarmApp(mcpTools);
  const supervisorApp = createSupervisorApp(mcpTools);
  const interruptApp = createInterruptApp();
  const analystApp = createAnalystApp();
  const researcherApp = createResearcherApp();
  const ragStore = await initRagStore();
  const ragApp = createRagApp(ragStore);

  const cfg = { configurable: { thread_id: "demo" } };

  // -- Swarm --
  console.log("=== Swarm Demo ===");
  const swarm1 = await swarmApp.invoke(
    { messages: [{ role: "user", content: "talk to bob then add 5 and 7" }] },
    cfg
  );
  console.log("swarm#1:", lastContent(swarm1.messages));

  const swarm2 = await swarmApp.invoke(
    { messages: [{ role: "user", content: "now multiply result by 3" }] },
    cfg
  );
  console.log("swarm#2:", lastContent(swarm2.messages));

  // -- Supervisor --
  console.log("\n=== Supervisor Demo ===");
  const sup = await supervisorApp.invoke(
    { messages: [{ role: "user", content: "sum 10 and 15, then write a one-line summary" }] },
    cfg
  );
  console.log("supervisor:", lastContent(sup.messages));

  // -- Structured Output --
  console.log("\n=== Structured Output Demo ===");
  const analysis = await analystApp.invoke(
    {
      messages: [{
        role: "user",
        content: "Analyze: Our Q4 revenue grew 25% YoY, but customer churn increased by 8%. The new product launch exceeded expectations with 50k signups in the first week.",
      }],
    },
    { configurable: { thread_id: "analyst-demo" } }
  );
  console.log("analyst:", lastContent(analysis.messages));

  // -- Research Agent --
  console.log("\n=== Research Agent Demo ===");
  const research = await researcherApp.invoke(
    {
      messages: [{
        role: "user",
        content: "Research the latest developments in LangGraph and multi-agent systems. Give me a brief summary.",
      }],
    },
    { configurable: { thread_id: "research-demo" } }
  );
  console.log("researcher:", lastContent(research.messages));

  // -- RAG --
  console.log("\n=== RAG Demo ===");
  const rag = await ragApp.invoke(
    {
      messages: [{
        role: "user",
        content: "What is the supervisor pattern and how does it differ from swarm?",
      }],
    },
    { configurable: { thread_id: "rag-demo" } }
  );
  console.log("rag:", lastContent(rag.messages));

  // -- Human-in-the-Loop --
  console.log("\n=== Human-in-the-Loop Demo ===");
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
}

run().catch((err: unknown) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
