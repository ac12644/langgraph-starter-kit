import { PORT } from "../config/env";
import { createSwarmApp } from "../apps/swarm";
import { createSupervisorApp } from "../apps/supervisor";
import { createInterruptApp } from "../apps/interrupt";
import { createAnalystApp } from "../apps/analyst";
import { createResearcherApp } from "../apps/researcher";
import { createRagApp } from "../apps/rag";
import { createSupportApp } from "../apps/support";
import { loadMcpTools } from "../tools/mcp";
import { asApp, buildServer, type AppGraph } from "./app";

// -- Startup --

export async function startServer(): Promise<void> {
  // Load MCP tools first — they get injected into agents
  const { tools: mcpTools, client: mcpClient } = await loadMcpTools();

  // RAG needs an embeddings provider. Providers without one (anthropic, groq,
  // deepseek) fall back to OpenAI, so a missing OPENAI_API_KEY must not stop
  // the whole server from starting — register the other apps and skip /rag.
  let ragApp: AppGraph | undefined;
  try {
    ragApp = asApp(await createRagApp());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`RAG app unavailable (embeddings failed): ${msg}`);
    console.warn("  /rag routes are disabled. Set EMBEDDINGS_PROVIDER (and its API key), or fix the embeddings error above.");
  }

  // Build apps with MCP tools available
  const apps = {
    swarm: asApp(await createSwarmApp(mcpTools)),
    supervisor: asApp(await createSupervisorApp(mcpTools)),
    interrupt: asApp(await createInterruptApp()),
    analyst: asApp(await createAnalystApp()),
    researcher: asApp(await createResearcherApp()),
    support: asApp(await createSupportApp()),
    ...(ragApp ? { rag: ragApp } : {}),
  } as Record<string, AppGraph>;

  const server = buildServer(apps, {
    mcpToolsLoaded: mcpTools.length,
    onClose: async () => {
      if (mcpClient) await mcpClient.close();
    },
  });

  // -- Graceful shutdown --

  // Container runtimes (Docker, Railway, Render) send SIGTERM on stop. Without
  // this, Node exits immediately: in-flight requests are cut off and Fastify's
  // onClose hook never runs, so the MCP client is never closed.
  let shuttingDown = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n${signal} received — draining connections...`);
      server
        .close()
        .then(() => {
          console.log("Shutdown complete.");
          process.exit(0);
        })
        .catch((err: unknown) => {
          console.error("Error during shutdown:", err);
          process.exit(1);
        });
    });
  }

  // -- Listen --

  await server.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Apps: ${Object.keys(apps).join(", ")}`);
  if (mcpTools.length > 0) {
    console.log(`MCP tools injected into: swarm, supervisor`);
  }
  console.log("Routes: POST /:app/invoke | POST /:app/stream | POST /:app/resume");
  console.log("        GET /:app/threads/:id | GET /:app/threads/:id/history");
}

startServer().catch((err: unknown) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});