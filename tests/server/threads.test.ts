import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Command, MemorySaver, interrupt } from "@langchain/langgraph";
import { makeAgent } from "../../src/agents/factory";
import { getThread, pendingInterrupts } from "../../src/server/threads";
import { ScriptedToolCallingModel } from "../helpers/scripted-model";

/**
 * The thread checks behind /resume, /threads/:id and the `interrupts` field,
 * run against a real checkpointed agent rather than hand-built snapshots —
 * the bugs they fix came from assuming what getState() returns.
 *
 * Before: getState() on an unknown thread returned `values: {}`, so the 404
 * branch never fired, and /resume sent a Command to threads that weren't
 * paused and returned 200.
 */

function buildApprovalAgent() {
  const deleteRecord = tool(
    async ({ id }) => {
      const decision = interrupt({ type: "approval_required", id });
      return decision === "yes" ? `Record ${id} deleted.` : "Deletion rejected.";
    },
    {
      name: "delete_record",
      description: "Delete a record (requires approval)",
      schema: z.object({ id: z.string() }),
    }
  );
  const llm = new ScriptedToolCallingModel([
    new AIMessage({
      content: "",
      tool_calls: [{ id: "c1", name: "delete_record", args: { id: "rec_2" } }],
    }),
    new AIMessage("Record rec_2 deleted."),
  ]);
  return makeAgent({
    name: "db_admin",
    llm,
    tools: [deleteRecord],
    checkpointer: new MemorySaver(),
  });
}

const statusOf = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (err: { statusCode?: number }) => err.statusCode
  );

describe("getThread", () => {
  it("404s on a thread that never ran", async () => {
    expect(await statusOf(getThread(buildApprovalAgent(), "never-ran"))).toBe(404);
  });
});

describe("pendingInterrupts", () => {
  it("reports the payload while paused and nothing after resume", async () => {
    const app = buildApprovalAgent();
    const config = { configurable: { thread_id: "t1" } };

    await app.invoke({ messages: [{ role: "user", content: "delete rec_2" }] }, config);
    const paused = await getThread(app, "t1");
    expect(pendingInterrupts(paused)).toEqual([{ type: "approval_required", id: "rec_2" }]);

    await app.invoke(new Command({ resume: "yes" }), config);
    const done = await getThread(app, "t1");
    expect(pendingInterrupts(done)).toEqual([]);
  });

  it("is empty for a thread that finished without pausing", async () => {
    const app = makeAgent({
      name: "chat",
      llm: new ScriptedToolCallingModel([new AIMessage("hi")]),
      checkpointer: new MemorySaver(),
    });
    await app.invoke(
      { messages: [{ role: "user", content: "hello" }] },
      { configurable: { thread_id: "t2" } }
    );
    expect(pendingInterrupts(await getThread(app, "t2"))).toEqual([]);
  });
});
