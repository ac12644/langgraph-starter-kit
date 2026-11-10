import { timingSafeEqual } from "node:crypto";
import { fastify, type FastifyError, type FastifyServerOptions, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { Command } from "@langchain/langgraph";
import { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import { httpError, validateMessages, validateThreadId } from "./validation";
import { assertDecisionAllowed, getThread, pendingInterrupts, type ThreadState } from "./threads";

// This module deliberately imports nothing from config/env, so tests can build
// the server without API keys. index.ts owns startup (MCP, listen, shutdown).

// -- Types --

interface InvokeBody {
  messages?: unknown;
  thread_id?: unknown;
}

interface ResumeBody {
  thread_id?: unknown;
  decision?: unknown;
}

interface StreamEvent {
  type: "token" | "message" | "interrupt" | "done" | "error";
  content?: string | unknown;
  node?: string;
}

/**
 * The routes only need this structural slice of a compiled graph. The apps
 * are a mix of `createAgent` agents and a custom StateGraph (swarm), whose
 * full generic types don't unify — this interface is what they share.
 */
export interface AppGraph {
  invoke(
    input: unknown,
    config?: unknown
  ): Promise<{ messages: BaseMessage[] } & Record<string, unknown>>;
  stream(
    input: unknown,
    config?: unknown
  ): Promise<AsyncIterable<[unknown, { langgraph_node?: string } | undefined]>>;
  getState(config: unknown): Promise<ThreadState | undefined>;
  getStateHistory(config: unknown): AsyncIterable<ThreadState>;
}

export const asApp = (graph: unknown) => graph as AppGraph;

export interface BuildServerOptions {
  /** Shown on /health. */
  mcpToolsLoaded?: number;
  /** Runs when the server closes (best-effort). */
  onClose?: () => Promise<void>;
  /** When set, every route except /health needs `Authorization: Bearer <apiKey>`. */
  apiKey?: string;
  /** Fastify logger options, e.g. `{ level: "info" }`. Logging is off when unset. */
  logger?: FastifyServerOptions["logger"];
  /** Abort runs that take longer than this. No limit when unset or 0. */
  runTimeoutMs?: number;
}

// -- Helpers --

function parseBody<T>(raw: unknown): T {
  return (raw ?? {}) as T;
}

function lastMessageContent(messages: BaseMessage[]): string | undefined {
  const last = messages.at(-1);
  if (!last) return undefined;
  return last.text;
}

// -- Server --

/** Builds the Fastify app and registers every route. Does not call listen(). */
export function buildServer(
  apps: Record<string, AppGraph>,
  options: BuildServerOptions = {}
): FastifyInstance {
  const { apiKey, logger = false, runTimeoutMs } = options;
  const server = fastify({ logger });

  server.setErrorHandler(async (error: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) req.log.error(error);
    return reply.status(status).send({
      error: error.message,
      ...(status === 500 ? { hint: "Check server logs for details" } : {}),
    });
  });

  if (apiKey) {
    const expected = Buffer.from(`Bearer ${apiKey}`);
    server.addHook("onRequest", async (req) => {
      if (req.routeOptions.url === "/health") return;
      const given = Buffer.from(req.headers.authorization ?? "");
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        throw httpError(401, "Missing or invalid API key");
      }
    });
  }

  const timeoutSignal = () => (runTimeoutMs ? AbortSignal.timeout(runTimeoutMs) : undefined);
  const timedOut = () => httpError(504, `Run timed out after ${runTimeoutMs}ms`);

  /** Runs one invoke, turning a timeout abort into a 504. */
  async function invokeWithTimeout(app: AppGraph, input: unknown, config: Record<string, unknown>) {
    const signal = timeoutSignal();
    try {
      return await app.invoke(input, { ...config, signal });
    } catch (err) {
      if (signal?.aborted) throw timedOut();
      throw err;
    }
  }

  function getApp(name: string) {
    if (!(name in apps)) {
      throw httpError(404, `Unknown app: "${name}". Available: ${Object.keys(apps).join(", ")}`);
    }
    return apps[name];
  }

  // -- Routes --

  server.post<{ Params: { app: string } }>("/:app/invoke", async (req, reply) => {
    const app = getApp(req.params.app);
    const body = parseBody<InvokeBody>(req.body);
    const messages = validateMessages(body.messages);
    const thread_id = validateThreadId(body.thread_id);

    const config = { configurable: { thread_id } };
    const result = await invokeWithTimeout(app, { messages }, config);

    return reply.send({
      messages: result.messages,
      structuredResponse: (result as Record<string, unknown>).structuredResponse ?? null,
      lastMessage: lastMessageContent(result.messages),
      // Non-empty = paused for approval; answer via POST /:app/resume.
      interrupts: pendingInterrupts(await app.getState(config)),
    });
  });

  server.post<{ Params: { app: string } }>("/:app/stream", async (req, reply) => {
    const app = getApp(req.params.app);
    const body = parseBody<InvokeBody>(req.body);
    const messages = validateMessages(body.messages);
    const thread_id = validateThreadId(body.thread_id);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const controller = new AbortController();
    // Client went away (closed tab, refresh, dropped connection): stop the run.
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    const timeout = timeoutSignal();
    const signal = timeout ? AbortSignal.any([controller.signal, timeout]) : controller.signal;

    const send = (event: StreamEvent) => {
      if (controller.signal.aborted) return;
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const stream = await app.stream(
        { messages },
        {
          configurable: { thread_id },
          streamMode: "messages",
          signal,
        }
      );

      for await (const [chunk, metadata] of stream) {
        const node = metadata?.langgraph_node ?? "unknown";

        if (chunk instanceof AIMessageChunk) {
          // Reasoning chunks have no text; don't emit empty token events.
          if (chunk.text) send({ type: "token", content: chunk.text, node });
        } else if (chunk && typeof chunk === "object" && "content" in chunk) {
          send({ type: "message", content: (chunk as BaseMessage).content, node });
        }
      }

      const interrupts = pendingInterrupts(
        await app.getState({ configurable: { thread_id } })
      );
      if (interrupts.length > 0) {
        send({ type: "interrupt", content: interrupts });
      }
      send({ type: "done" });
    } catch (err) {
      // An abort means the client left; there's nobody to report an error to.
      if (controller.signal.aborted) return;
      if (timeout?.aborted) {
        send({ type: "error", content: timedOut().message });
        return;
      }
      req.log.error(err);
      const msg = err instanceof Error ? err.message : "Stream failed";
      send({ type: "error", content: msg });
    } finally {
      reply.raw.end();
    }
  });

  server.post<{ Params: { app: string } }>("/:app/resume", async (req, reply) => {
    const app = getApp(req.params.app);
    const body = parseBody<ResumeBody>(req.body);
    const thread_id = validateThreadId(body.thread_id);
    const { decision } = body;
    // The value is checked against the interrupt's responseSchema below; a
    // missing one never gets that far: LangGraph rejects an empty Command.
    if (decision === undefined) {
      throw httpError(400, '"decision" is required');
    }

    // Without this check a Command sent to a thread that isn't paused is a
    // silent no-op that still returns 200 — an approval UI would report
    // "approved" for something that was never waiting.
    const state = await getThread(app, thread_id);
    if (pendingInterrupts(state).length === 0) {
      throw httpError(409, `Thread "${thread_id}" is not waiting for a decision`);
    }
    assertDecisionAllowed(state, decision);

    const config = { configurable: { thread_id } };
    const result = await invokeWithTimeout(app, new Command({ resume: decision }), config);

    return reply.send({
      messages: result.messages,
      lastMessage: lastMessageContent(result.messages),
      // A resumed run can pause again (e.g. a second approval).
      interrupts: pendingInterrupts(await app.getState(config)),
    });
  });

  server.get<{ Params: { app: string; threadId: string } }>(
    "/:app/threads/:threadId/history",
    async (req, reply) => {
      const app = getApp(req.params.app);
      const config = { configurable: { thread_id: req.params.threadId } };

      await getThread(app, req.params.threadId);

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
      const state = await getThread(getApp(req.params.app), req.params.threadId);

      return reply.send({
        values: state.values,
        next: state.next ?? [],
        tasks: state.tasks ?? [],
      });
    }
  );

  // Health checks hit this every few seconds; keep them out of the info logs.
  server.get("/health", { logLevel: "warn" }, async () => ({
    status: "ok",
    apps: Object.keys(apps),
    mcpToolsLoaded: options.mcpToolsLoaded ?? 0,
  }));

  // -- Cleanup --

  const { onClose } = options;
  if (onClose) {
    server.addHook("onClose", async () => {
      try {
        await onClose();
      } catch {
        // Cleanup is best-effort
      }
    });
  }

  return server;
}