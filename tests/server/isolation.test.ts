import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { humanInTheLoopMiddleware } from "langchain";
import { z } from "zod";
import { makeSupervisor } from "../../src/agents/supervisor";
import { makeAgent } from "../../src/agents/factory";
import { asApp, buildServer, type AppGraph } from "../../src/server/app";
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

// -- Several approvals at once --

/** issue_refund that records what actually ran, even inside a subagent. */
function spyRefund() {
  const ran: string[] = [];
  const refund = tool(
    async ({ orderId }) => {
      ran.push(orderId);
      return `Refunded ${orderId}.`;
    },
    { name: "issue_refund", description: "Refund an order.", schema: z.object({ orderId: z.string() }) }
  );
  return { ran, refund };
}

const approvals = () =>
  humanInTheLoopMiddleware({ interruptOn: { issue_refund: { allowedDecisions: ["approve", "reject"] } } });

const refundCalls = (...orderIds: string[]) =>
  new AIMessage({
    content: "",
    tool_calls: orderIds.map((orderId, i) => ({ id: `c${i}`, name: "issue_refund", args: { orderId } })),
  });

const resume = (server: FastifyInstance, payload: Record<string, unknown>) =>
  server.inject({ method: "POST", url: "/chat/resume", payload: { thread_id: "t1", ...payload } });

/**
 * One agent asking for two refunds in one turn. The middleware puts both in
 * one interrupt, so they stay visible even under a supervisor (with plain
 * interrupt() calls the parent saw only one, and its answer went to both).
 */
describe.each([
  [
    "agent",
    async (refund: ReturnType<typeof spyRefund>["refund"]) =>
      makeAgent({
        name: "billing",
        llm: new ScriptedToolCallingModel([refundCalls("ORD-501", "ORD-504"), new AIMessage("Done."), new AIMessage("Done again.")]),
        tools: [refund],
        checkpointer: new MemorySaver(),
        middleware: [approvals()],
      }),
  ],
  [
    "agent under a supervisor",
    async (refund: ReturnType<typeof spyRefund>["refund"]) => {
      const llm = new ScriptedToolCallingModel([
        new AIMessage({ content: "", tool_calls: [{ id: "s1", name: "billing", args: { task: "two refunds" } }] }),
        refundCalls("ORD-501", "ORD-504"),
        new AIMessage("Done."),
        new AIMessage("All handled."),
      ]);
      const billing = makeAgent({ name: "billing", llm, tools: [refund], middleware: [approvals()] });
      return makeSupervisor({
        subagents: [{ name: "billing", description: "Refunds.", agent: billing }],
        llm,
        checkpointer: new MemorySaver(),
      });
    },
  ],
])("two approvals in one turn with an %s", (_label, build) => {
  async function paused() {
    const { ran, refund } = spyRefund();
    const server = serve({ chat: asApp(await build(refund)) });
    const res = (await invoke(server, "chat", say("refund both", "t1"))).json();
    expect(res.interrupts).toHaveLength(1);
    expect(res.interrupts[0].value.actionRequests.map((a: { args: { orderId: string } }) => a.args.orderId)).toEqual([
      "ORD-501",
      "ORD-504",
    ]);
    return { server, ran };
  }

  it("needs one answer per action", async () => {
    const { server, ran } = await paused();
    const res = await resume(server, { decision: "approve" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('"decision" needs one answer per action: 2 pending, got 1');
    const bad = await resume(server, { decision: ["approve", "yes"] });
    expect(bad.json().error).toBe('"decision"[1] must be one of: "approve", "reject"');
    expect(ran).toEqual([]);
  });

  it("runs both when both are approved", async () => {
    const { server, ran } = await paused();
    expect((await resume(server, { decision: ["approve", "approve"] })).statusCode).toBe(200);
    expect(ran).toEqual(["ORD-501", "ORD-504"]);
  });

  // LangChain's rule: any rejection sends the model back to re-plan, and the
  // approved calls in that batch don't run either.
  it("runs neither when one is rejected", async () => {
    const { server, ran } = await paused();
    expect((await resume(server, { decision: ["approve", "reject"] })).statusCode).toBe(200);
    expect(ran).toEqual([]);
  });
});

/**
 * Two subagents each asking for one approval, in parallel. Those are separate
 * interrupts, answered by id.
 */
describe("approvals from two subagents at once", () => {
  async function paused() {
    const { ran, refund } = spyRefund();
    const subagent = (name: string, orderId: string) => ({
      name,
      description: name,
      agent: makeAgent({
        name,
        llm: new ScriptedToolCallingModel([refundCalls(orderId), new AIMessage(`${name} done`)]),
        tools: [refund],
        middleware: [approvals()],
      }),
    });
    const supervisor = await makeSupervisor({
      subagents: [subagent("billing_a", "ORD-501"), subagent("billing_b", "ORD-504")],
      llm: new ScriptedToolCallingModel([
        new AIMessage({
          content: "",
          tool_calls: [
            { id: "s1", name: "billing_a", args: { task: "a" } },
            { id: "s2", name: "billing_b", args: { task: "b" } },
          ],
        }),
        new AIMessage("All handled."),
      ]),
      checkpointer: new MemorySaver(),
    });
    const server = serve({ chat: asApp(supervisor) });
    const res = (await invoke(server, "chat", say("refund both", "t1"))).json();
    expect(res.interrupts).toHaveLength(2);
    const ids = Object.fromEntries(
      res.interrupts.map((i: { id: string; value: { actionRequests: { args: { orderId: string } }[] } }) => [
        i.value.actionRequests[0].args.orderId,
        i.id,
      ])
    ) as Record<string, string>;
    return { server, ran, ids };
  }

  it("rejects a single decision instead of applying it to both", async () => {
    const { server, ran } = await paused();
    const res = await resume(server, { decision: "approve" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('2 interrupts are pending; send "decisions" keyed by interrupt id');
    expect(ran).toEqual([]);
  });

  it("validates each entry of decisions", async () => {
    const { server, ids } = await paused();
    expect((await resume(server, { decisions: { nope: "approve" } })).json().error).toBe(
      'No pending interrupt with id "nope"'
    );
    const bad = await resume(server, { decisions: { [ids["ORD-501"]]: "yes" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe(`decisions["${ids["ORD-501"]}"] must be one of: "approve", "reject"`);
    expect((await resume(server, { decisions: [] })).statusCode).toBe(400);
  });

  it("needs an answer for every pending interrupt", async () => {
    const { server, ran, ids } = await paused();
    const res = await resume(server, { decisions: { [ids["ORD-501"]]: "approve" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(`"decisions" must answer every pending interrupt; missing: ${ids["ORD-504"]}`);
    expect(ran).toEqual([]);
  });

  it("applies each answer to its own interrupt", async () => {
    const { server, ran, ids } = await paused();
    const res = await resume(server, { decisions: { [ids["ORD-501"]]: "approve", [ids["ORD-504"]]: "reject" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().interrupts).toEqual([]);
    expect(ran).toEqual(["ORD-501"]);
  });
});
