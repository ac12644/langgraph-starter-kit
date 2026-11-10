import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { makeAgent } from "../../src/agents/factory";
import { makeSupervisor } from "../../src/agents/supervisor";
import { asApp, buildServer, type AppGraph } from "../../src/server/app";
import { escalateToHuman, initiateReturn, issueRefund } from "../../src/tools/support";
import { ScriptedToolCallingModel } from "../helpers/scripted-model";

/**
 * HITL tools declare the decision they accept with interrupt({ responseSchema }).
 * An invalid one must come back as a 400 and leave the thread paused, so the
 * caller can answer again. LangGraph's own check isn't enough here: inside a
 * createAgent tool its error goes to the model and the run carries on.
 */

const refundCall = new AIMessage({
  content: "",
  tool_calls: [{ id: "c1", name: "issue_refund", args: { orderId: "ORD-501", reason: "broken" } }],
});

function refundAgent() {
  return makeAgent({
    name: "billing",
    llm: new ScriptedToolCallingModel([refundCall, new AIMessage("Refund done.")]),
    tools: [issueRefund],
    checkpointer: new MemorySaver(),
  });
}

/** The same tool one level down, under a supervisor. */
async function supervisedRefundAgent() {
  const llm = new ScriptedToolCallingModel([
    new AIMessage({
      content: "",
      tool_calls: [{ id: "s1", name: "billing", args: { task: "refund ORD-501" } }],
    }),
    refundCall,
    new AIMessage("Refund done."),
    new AIMessage("The refund was issued."),
  ]);
  const billing = makeAgent({ name: "billing", llm, tools: [issueRefund] });
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

async function pausedServer(app: AppGraph) {
  const server = buildServer({ chat: app });
  servers.push(server);
  const res = await server.inject({
    method: "POST",
    url: "/chat/invoke",
    payload: { messages: [{ role: "user", content: "refund ORD-501" }], thread_id: "t1" },
  });
  expect(res.json().interrupts).toHaveLength(1);
  return server;
}

const resume = (server: FastifyInstance, payload: Record<string, unknown>) =>
  server.inject({ method: "POST", url: "/chat/resume", payload: { thread_id: "t1", ...payload } });

describe.each([
  ["agent", async () => asApp(refundAgent()), "Refund done."],
  ["agent under a supervisor", async () => asApp(await supervisedRefundAgent()), "The refund was issued."],
])("POST /:app/resume with an %s", (_label, build, finalReply) => {
  it("rejects an invalid decision with 400 and keeps the thread paused", async () => {
    const server = await pausedServer(await build());

    for (const decision of ["maybe", 42]) {
      const res = await resume(server, { decision });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('"decision" must be one of: "yes", "no"');
    }
    const missing = await resume(server, {});
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe('"decision" is required');

    // Still waiting, and a valid answer goes through. Had a schema error
    // reached the model, it would have used up a scripted reply and the final
    // message would differ.
    const ok = await resume(server, { decision: "yes" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().interrupts).toEqual([]);
    expect(ok.json().lastMessage).toBe(finalReply);
  });

});

it('treats "no" as a rejection', async () => {
  const server = await pausedServer(asApp(refundAgent()));

  const res = await resume(server, { decision: "no" });
  expect(res.statusCode).toBe(200);
  expect(JSON.stringify(res.json().messages)).toContain("Refund for order ORD-501 was rejected");
});

// Every approval tool in the support app declares its answers, so none of
// them quietly treats a typo as "no".
it.each([
  ["issue_refund", issueRefund, { orderId: "ORD-501", reason: "broken" }],
  ["initiate_return", initiateReturn, { orderId: "ORD-501", reason: "broken" }],
  ["escalate_to_human", escalateToHuman, { customerId: "C-1001", reason: "angry" }],
] as const)("%s only accepts yes or no", async (name, approvalTool, args) => {
  const agent = makeAgent({
    name: "support",
    llm: new ScriptedToolCallingModel([
      new AIMessage({ content: "", tool_calls: [{ id: "c1", name, args }] }),
      new AIMessage("ok"),
    ]),
    tools: [approvalTool],
    checkpointer: new MemorySaver(),
  });
  const server = await pausedServer(asApp(agent));

  const res = await resume(server, { decision: "maybe" });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('"decision" must be one of: "yes", "no"');
});
