import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { modelCallLimitMiddleware } from "langchain";
import { makeAgent } from "../../src/agents/factory";
import { makeSupervisor } from "../../src/agents/supervisor";
import { ScriptedToolCallingModel } from "../helpers/scripted-model";

/**
 * Middleware is passed through `makeAgent` and `makeSupervisor` to
 * `createAgent`. These assert the wiring actually takes effect, using a
 * scripted model so no API key or network is involved.
 */
describe("middleware", () => {
  it("makeAgent enforces a model call limit", async () => {
    const noop = tool(async () => "ok", {
      name: "noop",
      description: "Does nothing.",
      schema: z.object({}),
    });
    // A model that never stops asking for another tool call.
    const looping = () =>
      Array.from({ length: 12 }, (_, i) =>
        new AIMessage({
          content: "",
          tool_calls: [{ id: `c${i}`, name: "noop", args: {} }],
        })
      );
    const countCalls = async (middleware?: Parameters<typeof makeAgent>[0]["middleware"]) => {
      const agent = makeAgent({
        name: "a",
        llm: new ScriptedToolCallingModel(looping()),
        tools: [noop],
        ...(middleware ? { middleware } : {}),
      });
      const r = await agent.invoke({ messages: [{ role: "user", content: "go" }] });
      return r.messages.filter((m) => m.getType() === "ai").length;
    };

    const capped = await countCalls([
      modelCallLimitMiddleware({ runLimit: 2, exitBehavior: "end" }),
    ]);
    // Uncapped, the same scripted model keeps going until the queue runs out.
    const uncapped = await countCalls().catch(() => Infinity);

    expect(capped).toBeLessThan(uncapped);
    expect(capped).toBeLessThan(12);
  });

  it("makeSupervisor accepts middleware and still answers", async () => {
    const llm = new ScriptedToolCallingModel([new AIMessage("done")]);
    const worker = makeAgent({ name: "worker", llm, tools: [] });

    const app = await makeSupervisor({
      subagents: [{ name: "worker", description: "Does work.", agent: worker }],
      llm,
      checkpointer: new MemorySaver(),
      middleware: [modelCallLimitMiddleware({ runLimit: 5, exitBehavior: "end" })],
    });

    const result = await app.invoke(
      { messages: [{ role: "user", content: "hi" }] },
      { configurable: { thread_id: "mw-test" } }
    );
    expect(result.messages.at(-1)?.content).toBe("done");
  });

  it("omitting middleware leaves behavior unchanged", async () => {
    const llm = new ScriptedToolCallingModel([new AIMessage("plain")]);
    const agent = makeAgent({ name: "plain", llm, tools: [] });
    const result = await agent.invoke({ messages: [{ role: "user", content: "hi" }] });
    expect(result.messages.at(-1)?.content).toBe("plain");
  });
});
