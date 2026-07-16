import { describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { makeAgent } from "../../src/agents/factory";
import { createHandoffTool } from "../../src/agents/handoff";
import { makeSwarm } from "../../src/agents/swarm";
import { add, multiply } from "../../src/tools/local";
import { ScriptedToolCallingModel } from "../helpers/scripted-model";

function buildSwarm(llm: ScriptedToolCallingModel) {
  const alice = makeAgent({
    name: "alice",
    llm,
    tools: [add, createHandoffTool({ agentName: "bob" })],
    system: "You are Alice, an addition expert.",
  });
  const bob = makeAgent({
    name: "bob",
    llm,
    tools: [multiply, createHandoffTool({ agentName: "alice" })],
    system: "You are Bob, a multiplication expert.",
  });

  return makeSwarm({
    agents: [
      { name: "alice", agent: alice },
      { name: "bob", agent: bob },
    ],
    defaultActiveAgent: "alice",
    checkpointer: new MemorySaver(),
  });
}

describe("makeSwarm (handoffs pattern)", () => {
  it("hands off from alice to bob and remembers the active agent", async () => {
    const llm = new ScriptedToolCallingModel([
      // Turn 1: alice (default active agent) hands off to bob
      new AIMessage({
        content: "",
        tool_calls: [{ id: "h1", name: "transfer_to_bob", args: {} }],
      }),
      // ...bob picks up and answers
      new AIMessage("Bob here: 6 times 7 is 42."),
      // Turn 2 (same thread): routed straight to bob, who answers again
      new AIMessage("Bob again: still 42."),
    ]);

    const app = await buildSwarm(llm);
    const config = { configurable: { thread_id: "swarm-test" } };

    const first = await app.invoke(
      { messages: [{ role: "user", content: "ask bob to multiply 6 and 7" }] },
      config
    );
    expect(first.messages.at(-1)?.content).toBe("Bob here: 6 times 7 is 42.");
    expect(first.activeAgent).toBe("bob");

    // The handoff kept the history well-formed: the AI transfer call is
    // followed by its ToolMessage.
    const toolMessages = first.messages.filter((m) => m.getType() === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].content).toBe("Transferred to bob");

    // Second turn on the same thread goes straight to bob.
    const second = await app.invoke(
      { messages: [{ role: "user", content: "and again?" }] },
      config
    );
    expect(second.messages.at(-1)?.content).toBe("Bob again: still 42.");
    expect(second.activeAgent).toBe("bob");
  });

  it("stays with the active agent when no handoff happens", async () => {
    const llm = new ScriptedToolCallingModel([
      new AIMessage("Alice here: 5 plus 7 is 12."),
    ]);

    const app = await buildSwarm(llm);
    const result = await app.invoke(
      { messages: [{ role: "user", content: "add 5 and 7" }] },
      { configurable: { thread_id: "swarm-no-handoff" } }
    );

    expect(result.messages.at(-1)?.content).toBe("Alice here: 5 plus 7 is 12.");
  });
});
