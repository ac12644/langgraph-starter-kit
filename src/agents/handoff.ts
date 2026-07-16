import { z } from "zod";
import { tool, type ToolRuntime } from "@langchain/core/tools";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { SwarmStateType } from "./swarm";

export interface CreateHandoffToolParams {
  /** Name of the agent (graph node) to hand the conversation to. */
  agentName: string;
  description?: string;
}

/**
 * Handoff tool for the handoffs pattern (replaces the one from
 * @langchain/langgraph-swarm, which is no longer actively maintained).
 *
 * Returns a `Command` targeting the PARENT graph: it flips `activeAgent`
 * and jumps to the target agent's node. The calling agent's last AI message
 * (the one containing this tool call) plus a ToolMessage are copied into
 * parent state so the conversation history stays well-formed — the agent's
 * own run ends here and never returns its state to the parent.
 */
export function createHandoffTool({ agentName, description }: CreateHandoffToolParams) {
  return tool(
    async (_, runtime: ToolRuntime<SwarmStateType>) => {
      const lastAiMessage = [...(runtime.state.messages ?? [])]
        .reverse()
        .find(AIMessage.isInstance);
      const transferMessage = new ToolMessage({
        content: `Transferred to ${agentName}`,
        tool_call_id: runtime.toolCallId ?? "",
      });
      return new Command({
        goto: agentName,
        update: {
          activeAgent: agentName,
          messages: [lastAiMessage, transferMessage].filter(Boolean),
        },
        graph: Command.PARENT,
      });
    },
    {
      name: `transfer_to_${agentName}`,
      description: description ?? `Transfer the conversation to ${agentName}.`,
      schema: z.object({}),
    }
  );
}
