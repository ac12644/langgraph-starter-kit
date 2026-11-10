import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { makeAgent } from "../../src/agents/factory";
import { asApp, buildServer, type AppGraph } from "../../src/server/app";
import { issueRefund } from "../../src/tools/support";
import { ScriptedToolCallingModel } from "../helpers/scripted-model";

const servers: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

function serve(apps: Record<string, AppGraph>) {
  const server = buildServer(apps);
  servers.push(server);
  return server;
}

const invoke = (server: FastifyInstance, app: string, payload: Record<string, unknown>) =>
  server.inject({ method: "POST", url: `/${app}/invoke`, payload });

const say = (content: string, thread_id?: string) => ({
  messages: [{ role: "user", content }],
  ...(thread_id ? { thread_id } : {}),
});

const contents = (messages: { kwargs?: { content?: unknown } }[]) => messages.map((m) => m.kwargs?.content);

/**
 * With DATABASE_URL set, every app writes to the same Postgres tables, so
 * they effectively share one checkpointer. One shared MemorySaver reproduces
 * that here.
 */
describe("thread isolation", () => {
  const chat = (reply: string, saver: MemorySaver) =>
    asApp(makeAgent({ name: "chat", llm: new ScriptedToolCallingModel([new AIMessage(reply)]), checkpointer: saver }));

  it("keeps apps that share a checkpointer out of each other's threads", async () => {
    const saver = new MemorySaver();
    const server = serve({ a: chat("from A", saver), b: chat("from B", saver) });

    await invoke(server, "a", say("secret for A", "t1"));

    expect((await server.inject({ method: "GET", url: "/b/threads/t1" })).statusCode).toBe(404);
    const res = await invoke(server, "b", say("hi", "t1"));
    expect(contents(res.json().messages)).toEqual(["hi", "from B"]);
    // A's thread is still there under A.
    expect((await server.inject({ method: "GET", url: "/a/threads/t1" })).statusCode).toBe(200);
  });

  it("gives callers without a thread_id their own thread and returns it", async () => {
    const saver = new MemorySaver();
    const server = serve({
      chat: asApp(
        makeAgent({
          name: "chat",
          llm: new ScriptedToolCallingModel([new AIMessage("one"), new AIMessage("two")]),
          checkpointer: saver,
        })
      ),
    });

    const first = (await invoke(server, "chat", say("mine"))).json();
    const second = (await invoke(server, "chat", say("yours"))).json();

    expect(first.thread_id).toEqual(expect.any(String));
    expect(second.thread_id).not.toBe(first.thread_id);
    expect(contents(second.messages)).toEqual(["yours", "two"]);
  });

  it("requires thread_id on /resume", async () => {
    const server = serve({ chat: chat("hi", new MemorySaver()) });
    const res = await server.inject({ method: "POST", url: "/chat/resume", payload: { decision: "yes" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('"thread_id" is required');
  });
});

const twoRefunds = new AIMessage({
  content: "",
  tool_calls: [
    { id: "c1", name: "issue_refund", args: { orderId: "ORD-501", reason: "broken" } },
    { id: "c2", name: "issue_refund", args: { orderId: "ORD-504", reason: "late" } },
  ],
});

function billingAgent() {
  return asApp(
    makeAgent({
      name: "billing",
      llm: new ScriptedToolCallingModel([twoRefunds, new AIMessage("Done.")]),
      tools: [issueRefund],
      checkpointer: new MemorySaver(),
    })
  );
}

/** Pulls the tool results for each order out of a response, plain or nested. */
const refundResults = (body: unknown) => {
  const text = JSON.stringify(body);
  return {
    "ORD-501": text.includes("Refund of $79.99 issued") ? "issued" : text.includes("ORD-501 was rejected") ? "rejected" : "none",
    "ORD-504": text.includes("Refund of $59.99 issued") ? "issued" : text.includes("ORD-504 was rejected") ? "rejected" : "none",
  };
};

// Top-level agents only. Under a supervisor, LangGraph surfaces just one of a
// subagent's parallel interrupts and resumes all of them with that answer;
// the server can't see the hidden ones, so it can't guard that case.
describe("several pending interrupts", () => {
  async function paused() {
    const server = serve({ chat: billingAgent() });
    const res = (await invoke(server, "chat", say("refund both", "t1"))).json();
    expect(res.interrupts).toHaveLength(2);
    const ids = Object.fromEntries(
      res.interrupts.map((i: { id: string; value: { orderId: string } }) => [i.value.orderId, i.id])
    ) as Record<string, string>;
    return { server, ids };
  }

  const resume = (server: FastifyInstance, payload: Record<string, unknown>) =>
    server.inject({ method: "POST", url: "/chat/resume", payload: { thread_id: "t1", ...payload } });

  it("rejects a single decision instead of applying it to all of them", async () => {
    const { server } = await paused();

    const res = await resume(server, { decision: "yes" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('send "decisions" keyed by interrupt id');

    const state = (await server.inject({ method: "GET", url: "/chat/threads/t1" })).json();
    expect(state.tasks.flatMap((t: { interrupts?: unknown[] }) => t.interrupts ?? [])).toHaveLength(2);
  });

  it("validates each entry of decisions", async () => {
    const { server, ids } = await paused();

    expect((await resume(server, { decisions: { nope: "yes" } })).json().error).toBe('No pending interrupt with id "nope"');
    const bad = await resume(server, { decisions: { [ids["ORD-501"]]: "maybe" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe(`decisions["${ids["ORD-501"]}"] must be one of: "yes", "no"`);
    expect((await resume(server, { decisions: [] })).statusCode).toBe(400);
  });

  it("applies each decision to its own interrupt", async () => {
    const { server, ids } = await paused();

    const res = await resume(server, { decisions: { [ids["ORD-501"]]: "yes", [ids["ORD-504"]]: "no" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().interrupts).toEqual([]);

    const history = (await server.inject({ method: "GET", url: "/chat/threads/t1/history" })).json();
    expect(refundResults(history)).toEqual({ "ORD-501": "issued", "ORD-504": "rejected" });
  });
});
