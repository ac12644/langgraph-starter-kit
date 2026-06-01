import { fastify, type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import { Command } from "@langchain/langgraph";
import { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import { PORT } from "../config/env";
import { createSwarmApp } from "../apps/swarm";
import { createSupervisorApp } from "../apps/supervisor";
import { createInterruptApp } from "../apps/interrupt";
import { createAnalystApp } from "../apps/analyst";
import { createResearcherApp } from "../apps/researcher";
import { createRagApp, initRagStore } from "../apps/rag";
import { createSupportApp } from "../apps/support";
import { loadMcpTools } from "../tools/mcp";

// -- Types --

interface InvokeBody {
  messages?: { role: string; content: string }[];
  thread_id?: string;
}

interface ResumeBody {
  thread_id?: string;
  decision?: string;
}

interface StreamEvent {
  type: "token" | "message" | "done" | "error";
  content?: string | unknown;
  node?: string;
}

// -- Helpers --

function parseBody<T>(raw: unknown): T {
  return (raw ?? {}) as T;
}

function lastMessageContent(messages: BaseMessage[]): string | undefined {
  const last = messages.at(-1);
  if (!last) return undefined;
  return typeof last.content === "string" ? last.content : JSON.stringify(last.content);
}

// -- Server --

const server = fastify({ logger: false });

server.setErrorHandler(async (error: FastifyError, _req: FastifyRequest, reply: FastifyReply) => {
  const status = error.statusCode ?? 500;
  return reply.status(status).send({
    error: error.message,
    ...(status === 500 ? { hint: "Check server logs for details" } : {}),
  });
});

// -- Startup --

export async function startServer(): Promise<void> {
  // Load MCP tools first — they get injected into agents
  const { tools: mcpTools, client: mcpClient } = await loadMcpTools();

  // Initialize RAG vector store (async — must complete before building apps)
  const ragStore = await initRagStore();

  // Build apps with MCP tools available
  const swarmApp = await createSwarmApp(mcpTools);
  const apps = {
    swarm: swarmApp,
    supervisor: (await createSupervisorApp(mcpTools)) as typeof swarmApp,
    interrupt: (await createInterruptApp()) as typeof swarmApp,
    analyst: (await createAnalystApp()) as typeof swarmApp,
    researcher: (await createResearcherApp()) as typeof swarmApp,
    rag: (await createRagApp(ragStore)) as typeof swarmApp,
    support: (await createSupportApp()) as typeof swarmApp,
  };

  type AppName = keyof typeof apps;

  function getApp(name: string) {
    if (!(name in apps)) {
      throw new Error(`Unknown app: "${name}". Available: ${Object.keys(apps).join(", ")}`);
    }
    return apps[name as AppName];
  }

  // -- Routes --

  server.post<{ Params: { app: string } }>("/:app/invoke", async (req, reply) => {
    const app = getApp(req.params.app);
    const { messages = [], thread_id = "default" } = parseBody<InvokeBody>(req.body);

    const result = await app.invoke(
      { messages },
      { configurable: { thread_id } }
    );

    return reply.send({
      messages: result.messages,
      structuredResponse: (result as Record<string, unknown>).structuredResponse ?? null,
      lastMessage: lastMessageContent(result.messages),
    });
  });

  server.post<{ Params: { app: string } }>("/:app/stream", async (req, reply) => {
    const app = getApp(req.params.app);
    const { messages = [], thread_id = "default" } = parseBody<InvokeBody>(req.body);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = (event: StreamEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const stream = await app.stream(
        { messages },
        { configurable: { thread_id }, streamMode: "messages" }
      );

      for await (const [chunk, metadata] of stream) {
        const node = metadata?.langgraph_node ?? "unknown";

        if (chunk instanceof AIMessageChunk) {
          send({ type: "token", content: chunk.content, node });
        } else if (chunk && typeof chunk === "object" && "content" in chunk) {
          send({ type: "message", content: (chunk as BaseMessage).content, node });
        }
      }

      send({ type: "done" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stream failed";
      send({ type: "error", content: msg });
    } finally {
      reply.raw.end();
    }
  });

  server.post<{ Params: { app: string } }>("/:app/resume", async (req, reply) => {
    const app = getApp(req.params.app);
    const { thread_id = "default", decision } = parseBody<ResumeBody>(req.body);

    if (decision === undefined) {
      return reply.status(400).send({ error: '"decision" field is required' });
    }

    const result = await app.invoke(
      new Command({ resume: decision }),
      { configurable: { thread_id } }
    );

    return reply.send({
      messages: result.messages,
      lastMessage: lastMessageContent(result.messages),
    });
  });

  server.get<{ Params: { app: string; threadId: string } }>(
    "/:app/threads/:threadId/history",
    async (req, reply) => {
      const app = getApp(req.params.app);
      const config = { configurable: { thread_id: req.params.threadId } };

      const states: Record<string, unknown>[] = [];
      for await (const snapshot of app.getStateHistory(config)) {
        states.push({
          values: snapshot.values ?? null,
          next: snapshot.next ?? [],
          tasks: snapshot.tasks ?? [],
          createdAt: snapshot.createdAt ?? null,
        });
      }

      return reply.send({ history: states });
    }
  );

  server.get<{ Params: { app: string; threadId: string } }>(
    "/:app/threads/:threadId",
    async (req, reply) => {
      const app = getApp(req.params.app);
      const config = { configurable: { thread_id: req.params.threadId } };

      const state = await app.getState(config);
      if (!state?.values) {
        return reply.status(404).send({ error: "Thread not found" });
      }

      return reply.send({
        values: state.values,
        next: state.next ?? [],
        tasks: state.tasks ?? [],
      });
    }
  );

  server.get("/health", async () => ({
    status: "ok",
    apps: Object.keys(apps),
    mcpToolsLoaded: mcpTools.length,
  }));

  // -- Cleanup --

  server.addHook("onClose", async () => {
    try {
      if (mcpClient) await mcpClient.close();
    } catch {
      // MCP client cleanup is best-effort
    }
  });

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
