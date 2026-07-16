import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Command, MemorySaver, interrupt } from "@langchain/langgraph";
import { makeAgent } from "../../src/agents/factory";
import { makeSupervisor } from "../../src/agents/supervisor";
import { add } from "../../src/tools/local";
import { ScriptedToolCallingModel } from "../helpers/scripted-model";

function buildSupervisor(llm: ScriptedToolCallingModel) {
  const math = makeAgent({
    name: "math_expert",
    llm,
    tools: [add],
    system: "You are a math expert.",
  });
  const writer = makeAgent({
    name: "writer",
    llm,
    tools: [],
    system: "You write crisp answers.",
  });

  return makeSupervisor({
    subagents: [
      { name: "math_expert", description: "Delegate calculations.", agent: math },
      { name: "writer", description: "Delegate writing.", agent: writer },
    ],
    llm,
    checkpointer: new MemorySaver(),
  });
}

describe("makeSupervisor (subagents-as-tools)", () => {
  it("runs the full delegation chain: supervisor -> math_expert -> add -> writer -> final", async () => {
    const FINAL = "The sum is 25. Summary: 10 + 15 = 25 — simple addition, tidy result.";
    const llm = new ScriptedToolCallingModel([
      // 1. Supervisor delegates to the math subagent
      new AIMessage({
        content: "",
        tool_calls: [{ id: "c1", name: "math_expert", args: { task: "sum 10 and 15" } }],
      }),
      // 2. Math subagent calls the add tool
      new AIMessage({
        content: "",
        tool_calls: [{ id: "c2", name: "add", args: { a: 10, b: 15 } }],
      }),
      // 3. Math subagent answers with the tool result
      new AIMessage("The sum of 10 and 15 is 25."),
      // 4. Supervisor delegates to the writer subagent
      new AIMessage({
        content: "",
        tool_calls: [{
          id: "c3",
          name: "writer",
          args: { task: "One-line summary: the sum of 10 and 15 is 25." },
        }],
      }),
      // 5. Writer subagent responds
      new AIMessage("10 + 15 = 25 — simple addition, tidy result."),
      // 6. Supervisor produces the final answer
      new AIMessage(FINAL),
    ]);

    const app = await buildSupervisor(llm);
    const result = await app.invoke(
      { messages: [{ role: "user", content: "sum 10 and 15, then write a one-line summary" }] },
      { configurable: { thread_id: "supervisor-test" } }
    );

    expect(result.messages.at(-1)?.content).toBe(FINAL);

    const toolMessages = result.messages.filter((m) => m.getType() === "tool");
    expect(toolMessages).toHaveLength(2);
    // The math subagent's answer (not its internal add-tool chatter) is what
    // the supervisor sees — context isolation working as intended.
    expect(toolMessages[0].content).toBe("The sum of 10 and 15 is 25.");
    expect(toolMessages[1].content).toBe("10 + 15 = 25 — simple addition, tidy result.");
  });

  it("keeps conversation memory on the supervisor thread", async () => {
    const llm = new ScriptedToolCallingModel([
      new AIMessage("Hello! How can I help?"),
      new AIMessage("You said: hi."),
    ]);

    const app = await buildSupervisor(llm);
    const config = { configurable: { thread_id: "supervisor-memory-test" } };

    await app.invoke({ messages: [{ role: "user", content: "hi" }] }, config);
    const second = await app.invoke(
      { messages: [{ role: "user", content: "what did I say?" }] },
      config
    );

    // 2 user messages + 2 AI responses accumulated on the same thread
    expect(second.messages).toHaveLength(4);
  });

  it("bubbles interrupt() from a subagent tool up to the supervisor thread", async () => {
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
      // 1. Supervisor delegates to the admin subagent
      new AIMessage({
        content: "",
        tool_calls: [{ id: "c1", name: "db_admin", args: { task: "delete rec_2" } }],
      }),
      // 2. Subagent calls delete_record -> interrupt() pauses everything
      new AIMessage({
        content: "",
        tool_calls: [{ id: "c2", name: "delete_record", args: { id: "rec_2" } }],
      }),
      // 3. (after resume) subagent reports the outcome
      new AIMessage("Record rec_2 deleted."),
      // 4. Supervisor answers the user
      new AIMessage("Done — rec_2 was deleted after approval."),
    ]);

    const admin = makeAgent({
      name: "db_admin",
      llm,
      tools: [deleteRecord],
      system: "You administer records.",
    });
    const app = await makeSupervisor({
      subagents: [
        { name: "db_admin", description: "Manages records.", agent: admin },
      ],
      llm,
      checkpointer: new MemorySaver(),
    });

    const config = { configurable: { thread_id: "supervisor-interrupt-test" } };
    await app.invoke(
      { messages: [{ role: "user", content: "delete rec_2" }] },
      config
    );

    // The graph should be paused waiting for approval
    const paused = await app.getState(config);
    expect(paused.next.length).toBeGreaterThan(0);
    const interrupts = paused.tasks.flatMap((t) => t.interrupts ?? []);
    expect(interrupts.length).toBeGreaterThan(0);
    expect(interrupts[0].value).toMatchObject({ type: "approval_required", id: "rec_2" });

    // Approving resumes through both agent layers
    const resumed = await app.invoke(new Command({ resume: "yes" }), config);
    expect(resumed.messages.at(-1)?.content).toBe("Done — rec_2 was deleted after approval.");
  });
});
