import { z } from "zod";
import { ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import {
  Command,
  MessagesAnnotation,
  getCurrentTaskInput,
} from "@langchain/langgraph";

interface HandoffToolParams {
  agentName: string;
  description?: string;
}

export function createHandoffTool({ agentName, description }: HandoffToolParams) {
  const toolName = `transfer_to_${agentName.replace(/\s+/g, "_").toLowerCase()}`;

  return tool(
    async (_args, cfg) => {
      const state = getCurrentTaskInput() as (typeof MessagesAnnotation)["State"];
      const messages = state.messages ?? [];

      const tm = new ToolMessage({
        content: `Transferred to ${agentName}`,
        name: toolName,
        tool_call_id: cfg.toolCall.id,
      });

      return new Command({
        goto: agentName,
        graph: Command.PARENT,
        update: {
          messages: messages.concat(tm),
          activeAgent: agentName,
        },
      });
    },
    {
      name: toolName,
      description: description ?? `Ask ${agentName} for help`,
      schema: z.object({}),
    }
  );
}
