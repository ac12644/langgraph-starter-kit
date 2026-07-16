import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { makeAgent, type AgentGraph } from "./factory";

/**
 * Supervisor via the "subagents" pattern: a main agent coordinates workers
 * by calling them as tools. This replaces @langchain/langgraph-supervisor,
 * which is no longer actively maintained.
 *
 * Compared to the old package:
 * - Routing is ordinary tool calling — no handoff machinery.
 * - Subagents are stateless and run in isolated context windows; the main
 *   agent only sees each subagent's final answer (the old `outputMode:
 *   "last_message"` behavior, now simply how the tool wrapper is written).
 * - Only the supervisor gets a checkpointer. Subagents inherit it at
 *   runtime, so `interrupt()` inside a subagent tool pauses the whole graph
 *   and `Command({ resume })` on the supervisor thread resumes it.
 */

export interface SubagentSpec {
  /** Tool name the supervisor calls, e.g. "math_expert". */
  name: string;
  /** Tells the supervisor's model when to delegate to this agent. */
  description: string;
  agent: AgentGraph;
}

/** Wraps a compiled agent as a tool the supervisor can call. */
export function subagentTool({ name, description, agent }: SubagentSpec) {
  return tool(
    async ({ task }) => {
      const result = await agent.invoke({
        messages: [{ role: "user", content: task }],
      });
      const last = result.messages.at(-1);
      if (!last) return "(no response)";
      return typeof last.content === "string"
        ? last.content
        : JSON.stringify(last.content);
    },
    {
      name,
      description,
      schema: z.object({
        task: z
          .string()
          .describe("A self-contained task with all context the agent needs"),
      }),
    }
  );
}

export interface MakeSupervisorParams {
  subagents: SubagentSpec[];
  llm: BaseChatModel;
  supervisorName?: string;
  prompt?: string;
  checkpointer?: BaseCheckpointSaver;
}

export async function makeSupervisor({
  subagents,
  llm,
  supervisorName = "supervisor",
  prompt,
  checkpointer,
}: MakeSupervisorParams) {
  const defaultPrompt =
    "You coordinate a team of specialists. Delegate work to them via " +
    `your tools (${subagents.map((s) => s.name).join(", ")}) and answer ` +
    "the user only once the delegated work is done.";

  // Lazy import: config/env validates provider API keys at import time,
  // which callers supplying their own checkpointer (e.g. tests) shouldn't
  // have to satisfy.
  const resolvedCheckpointer =
    checkpointer ?? (await (await import("../config/checkpointer")).getCheckpointer());

  return makeAgent({
    name: supervisorName,
    llm,
    tools: subagents.map(subagentTool),
    system: prompt ?? defaultPrompt,
    checkpointer: resolvedCheckpointer,
  });
}
