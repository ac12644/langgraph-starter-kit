import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { getLlm } from "../config/llm";
import { getCheckpointer } from "../config/checkpointer";
import { makeAgent } from "../agents/factory";

const deleteRecord = tool(
  async (args) => {
    const decision = interrupt({
      type: "approval_required",
      message: `Delete record "${args.id}"? This cannot be undone.`,
      args,
    });

    if (decision !== "yes") {
      return `Deletion of "${args.id}" was rejected by the user.`;
    }

    return `Record "${args.id}" deleted successfully.`;
  },
  {
    name: "delete_record",
    description: "Delete a record by ID. Requires human approval.",
    schema: z.object({ id: z.string().describe("The record ID to delete") }),
  }
);

const listRecords = tool(
  async () => {
    return JSON.stringify([
      { id: "rec_1", name: "Alice" },
      { id: "rec_2", name: "Bob" },
      { id: "rec_3", name: "Charlie" },
    ]);
  },
  {
    name: "list_records",
    description: "List all records",
    schema: z.object({}),
  }
);

export async function createInterruptApp() {
  const llm = await getLlm();

  // A single agent with a checkpointer — interrupt() inside delete_record
  // pauses the graph; resume with Command({ resume: "yes" }) on the thread.
  return makeAgent({
    name: "db_admin",
    llm,
    tools: [listRecords, deleteRecord],
    system:
      "You are a database administrator. You can list and delete records. When asked to delete a record, use the delete_record tool immediately — the tool itself handles approval.",
    checkpointer: await getCheckpointer(),
  });
}
