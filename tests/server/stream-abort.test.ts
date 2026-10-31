import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { makeAgent } from "../../src/agents/factory";
import { asApp, buildServer } from "../../src/server/app";
import { ScriptedToolCallingModel } from "../helpers/scripted-model";

/**
 * /stream must stop the run when the client disconnects. The agent calls a
 * tool that blocks on a gate; we close the client socket while it's blocked,
 * then release the gate. If the run was aborted, the model never gets its
 * second call (the one that would produce the final answer).
 *
 * The first test is the control: with the client still connected the same
 * script does make a second model call, so the assertion in the second test
 * can only pass because of the abort.
 */

class CountingModel extends ScriptedToolCallingModel {
  calls = 0;

  override async _generate(...args: Parameters<ScriptedToolCallingModel["_generate"]>) {
    this.calls++;
    return super._generate(...args);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function buildScenario() {
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));

  const slowTool = tool(
    async () => {
      markStarted();
      await gate;
      return "ok";
    },
    { name: "slow_tool", description: "Blocks until released", schema: z.object({}) }
  );

  const model = new CountingModel([
    new AIMessage({
      content: "",
      tool_calls: [{ id: "c1", name: "slow_tool", args: {} }],
    }),
    new AIMessage("all done"),
  ]);

  const agent = makeAgent({
    name: "chat",
    llm: model,
    tools: [slowTool],
    checkpointer: new MemorySaver(),
  });

  return { agent, model, started, release };
}

const servers: FastifyInstance[] = [];

async function start(apps: Parameters<typeof buildServer>[0]) {
  const server = buildServer(apps);
  servers.push(server);
  return server.listen({ port: 0, host: "127.0.0.1" });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const request = (url: string, signal?: AbortSignal) =>
  fetch(`${url}/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "go" }],
      thread_id: "abort-test",
    }),
    signal,
  });

describe("POST /:app/stream", () => {
  it("control: runs to completion while the client stays connected", async () => {
    const { agent, model, release } = buildScenario();
    const url = await start({ chat: asApp(agent) });

    release();
    const res = await request(url);
    const body = await res.text();

    expect(body).toContain('"type":"done"');
    expect(model.calls).toBe(2);
  }, 15_000);

  it("stops the run when the client disconnects mid-run", async () => {
    const { agent, model, started, release } = buildScenario();
    const url = await start({ chat: asApp(agent) });

    const client = new AbortController();
    const pending = request(url, client.signal).catch(() => undefined);

    await started; // the tool is running
    client.abort(); // client goes away
    await pending;
    await sleep(150); // let the server notice the closed socket

    release(); // the tool finishes; a live run would now call the model again
    await sleep(300);

    expect(model.calls).toBe(1);
  }, 15_000);
});