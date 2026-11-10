import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { MemorySaver, interrupt } from "@langchain/langgraph";
import { humanInTheLoopMiddleware } from "langchain";
import { makeAgent } from "../../src/agents/factory";
import { makeSupervisor } from "../../src/agents/supervisor";
import { asApp, buildServer, type AppGraph } from "../../src/server/app";
import { escalateToHuman, initiateReturn, issueRefund, SUPPORT_APPROVALS } from "../../src/tools/support";
import { ScriptedToolCallingModel } from "../helpers/scripted-model";

/**
 * Approvals come from humanInTheLoopMiddleware. A bad answer must come back
 * as a 400 and leave the thread paused, so the caller can answer again: the
 * middleware itself throws, which is a 500 on a plain agent and, under a
 * supervisor, a tool error the model reads while the run carries on.
 */

const approvals = () => humanInTheLoopMiddleware({ interruptOn: SUPPORT_APPROVALS });

const call = (name: string, args: Record<string, unknown>, id = "c1") =>
  new AIMessage({ content: "", tool_calls: [{ id, name, args }] });

const refundCall = call("issue_refund", { orderId: "ORD-501", reason: "broken" });

function refundAgent() {
  return makeAgent({
    name: "billing",
    llm: new ScriptedToolCallingModel([refundCall, new AIMessage("Refund done.")]),
    tools: [issueRefund],
    checkpointer: new MemorySaver(),
    middleware: [approvals()],
  });
}

/** The same tool one level down, under a supervisor. */
async function supervisedRefundAgent() {
  const llm = new ScriptedToolCallingModel([
    call("billing", { task: "refund ORD-501" }, "s1"),
    refundCall,
    new AIMessage("Refund done."),
    new AIMessage("The refund was issued."),
  ]);
  const billing = makeAgent({ name: "billing", llm, tools: [issueRefund], middleware: [approvals()] });
  return makeSupervisor({
    subagents: [{ name: "billing", description: "Handles refunds.", agent: billing }],
    llm,
    checkpointer: new MemorySaver(),
  });
}

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function invoke(app: AppGraph) {
  const server = buildServer({ chat: app });
  servers.push(server);
  const res = await server.inject({
    method: "POST",
    url: "/chat/invoke",
    payload: { messages: [{ role: "user", content: "refund ORD-501" }], thread_id: "t1" },
  });
  return { server, body: res.json() };
}

async function pausedServer(app: AppGraph) {
  const { server, body } = await invoke(app);
  expect(body.interrupts).toHaveLength(1);
  return server;
}

const resume = (server: FastifyInstance, payload: Record<string, unknown>) =>
  server.inject({ method: "POST", url: "/chat/resume", payload: { thread_id: "t1", ...payload } });

describe.each([
  ["agent", async () => asApp(refundAgent()), "Refund done."],
  ["agent under a supervisor", async () => asApp(await supervisedRefundAgent()), "The refund was issued."],
])("POST /:app/resume with an %s", (_label, build, finalReply) => {
  it("describes the pending action", async () => {
    const { body } = await invoke(await build());
    expect(body.interrupts[0].value.actionRequests).toEqual([
      expect.objectContaining({
        name: "issue_refund",
        description: "Refund $79.99 for order ORD-501 (Wireless Headphones)? Reason: broken",
      }),
    ]);
  });

  it("rejects an invalid answer with 400 and keeps the thread paused", async () => {
    const server = await pausedServer(await build());

    for (const decision of ["maybe", "yes", 42, { type: "edit" }]) {
      const res = await resume(server, { decision });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('"decision" must be one of: "approve", "reject"');
    }
    const tooMany = await resume(server, { decision: ["approve", "approve"] });
    expect(tooMany.json().error).toBe('"decision" needs one answer per action: 1 pending, got 2');
    const missing = await resume(server, {});
    expect(missing.json().error).toBe('"decision" is required');

    // Still waiting, and a valid answer goes through. Had a bad answer
    // reached the agent, it would have used up a scripted reply and the final
    // message would differ.
    const ok = await resume(server, { decision: "approve" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().interrupts).toEqual([]);
    expect(ok.json().lastMessage).toBe(finalReply);
  });
});

it("does not run a rejected action", async () => {
  const server = await pausedServer(asApp(refundAgent()));

  const res = await resume(server, { decision: { type: "reject", message: "Not eligible." } });
  expect(res.statusCode).toBe(200);
  const text = JSON.stringify(res.json().messages);
  expect(text).toContain("Not eligible.");
  expect(text).not.toContain("Refund of $79.99 issued");
});

describe("support approvals", () => {
  it.each([
    ["issue_refund", issueRefund, { orderId: "ORD-501", reason: "broken" }],
    ["initiate_return", initiateReturn, { orderId: "ORD-501", reason: "broken" }],
    ["escalate_to_human", escalateToHuman, { customerId: "C-1001", reason: "angry" }],
  ] as const)("%s waits for approve or reject", async (name, approvalTool, args) => {
    const agent = makeAgent({
      name: "support",
      llm: new ScriptedToolCallingModel([call(name, args), new AIMessage("ok")]),
      tools: [approvalTool],
      checkpointer: new MemorySaver(),
      middleware: [approvals()],
    });
    const server = await pausedServer(asApp(agent));
    expect((await resume(server, { decision: "yes" })).statusCode).toBe(400);
    expect((await resume(server, { decision: "approve" })).statusCode).toBe(200);
  });

  // No point asking a human about something the tool will refuse.
  it.each([
    ["issue_refund", issueRefund, { orderId: "ORD-999", reason: "x" }, "ORD-999"],
    ["initiate_return", initiateReturn, { orderId: "ORD-502", reason: "x" }, "Cannot initiate return"],
  ] as const)("%s skips the approval when the tool would refuse", async (name, approvalTool, args, toolReply) => {
    const agent = makeAgent({
      name: "support",
      llm: new ScriptedToolCallingModel([call(name, args), new AIMessage("ok")]),
      tools: [approvalTool],
      checkpointer: new MemorySaver(),
      middleware: [approvals()],
    });
    const { body } = await invoke(asApp(agent));
    expect(body.interrupts).toEqual([]);
    expect(JSON.stringify(body.messages)).toContain(toolReply);
  });
});

// Plain interrupt() calls (see docs/BUILDING.md) still get their
// responseSchema checked.
it("checks a custom interrupt's responseSchema", async () => {
  const confirm = tool(
    async () => (interrupt("Proceed?", { responseSchema: z.enum(["yes", "no"]) }) === "yes" ? "done" : "skipped"),
    { name: "confirm", description: "Asks first", schema: z.object({}) }
  );
  const agent = makeAgent({
    name: "custom",
    llm: new ScriptedToolCallingModel([call("confirm", {}), new AIMessage("ok")]),
    tools: [confirm],
    checkpointer: new MemorySaver(),
  });
  const server = await pausedServer(asApp(agent));

  const res = await resume(server, { decision: "maybe" });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('"decision" must be one of: "yes", "no"');
  expect((await resume(server, { decision: "yes" })).statusCode).toBe(200);
});
