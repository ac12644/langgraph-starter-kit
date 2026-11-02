import { afterEach, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { makeAgent } from "../../src/agents/factory";
import { asApp, buildServer, type AppGraph, type BuildServerOptions } from "../../src/server/app";
import { ScriptedToolCallingModel } from "../helpers/scripted-model";

/** Answers after `ms`, so a short run timeout can fire first. */
class SlowModel extends ScriptedToolCallingModel {
  constructor(private ms: number) {
    super([new AIMessage("slow answer")]);
  }

  override async _generate(...args: Parameters<ScriptedToolCallingModel["_generate"]>) {
    await new Promise((resolve) => setTimeout(resolve, this.ms));
    return super._generate(...args);
  }
}

const chatApp = (llm = new ScriptedToolCallingModel([new AIMessage("hi")])) =>
  asApp(makeAgent({ name: "chat", llm, tools: [], checkpointer: new MemorySaver() }));

const servers: FastifyInstance[] = [];

function serve(apps: Record<string, AppGraph>, options: BuildServerOptions = {}) {
  const server = buildServer(apps, options);
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const invoke = (server: FastifyInstance, path = "/chat/invoke", authorization?: string) =>
  server.inject({
    method: "POST",
    url: path,
    headers: authorization ? { authorization } : {},
    payload: { messages: [{ role: "user", content: "hi" }], thread_id: "t1" },
  });

describe("API key", () => {
  it("rejects requests without the key, accepts the right one", async () => {
    const server = serve({ chat: chatApp() }, { apiKey: "secret" });

    expect((await invoke(server)).statusCode).toBe(401);
    expect((await invoke(server, undefined, "Bearer wrong")).statusCode).toBe(401);
    expect((await invoke(server, undefined, "Bearer secret")).statusCode).toBe(200);
  });

  it("leaves /health open for container health checks", async () => {
    const server = serve({ chat: chatApp() }, { apiKey: "secret" });
    expect((await server.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  it("is off when no key is configured", async () => {
    const server = serve({ chat: chatApp() });
    expect((await invoke(server)).statusCode).toBe(200);
  });
});

describe("error logging", () => {
  it("logs 500s", async () => {
    let logs = "";
    const stream = new Writable({
      write(chunk, _enc, done) {
        logs += chunk;
        done();
      },
    });
    const broken = { ...chatApp(), invoke: async () => Promise.reject(new Error("kaboom")) };
    const server = serve({ chat: broken as AppGraph }, { logger: { level: "error", stream } });

    expect((await invoke(server)).statusCode).toBe(500);
    expect(logs).toContain("kaboom");
  });
});

describe("run timeout", () => {
  it("returns 504 when /invoke runs too long", async () => {
    const server = serve({ chat: chatApp(new SlowModel(2_000)) }, { runTimeoutMs: 100 });

    const res = await invoke(server);
    expect(res.statusCode).toBe(504);
    expect(res.json().error).toContain("timed out");
  });

  it("sends an error event when /stream runs too long", async () => {
    const server = serve({ chat: chatApp(new SlowModel(2_000)) }, { runTimeoutMs: 100 });

    const res = await invoke(server, "/chat/stream");
    expect(res.body).toContain('"type":"error"');
    expect(res.body).toContain("timed out");
    expect(res.body).not.toContain('"type":"done"');
  });

  it("control: a fast run finishes under the timeout", async () => {
    const server = serve({ chat: chatApp(new SlowModel(10)) }, { runTimeoutMs: 1_000 });

    const res = await invoke(server);
    expect(res.statusCode).toBe(200);
    expect(res.json().lastMessage).toBe("slow answer");
  });
});
