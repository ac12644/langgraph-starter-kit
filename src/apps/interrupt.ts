import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { humanInTheLoopMiddleware } from "langchain";
import { getLlm } from "../config/llm";
import { getCheckpointer } from "../config/checkpointer";
import { makeAgent } from "../agents/factory";

const deleteRecord = tool(
  async ({ id }) => `Record "${id}" deleted successfully.`,
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

  // A single agent with a checkpointer. The middleware pauses before
  // delete_record runs; resume on the same thread with
  // Command({ resume: { decisions: [{ type: "approve" }] } }), or "reject".
  return makeAgent({
    name: "db_admin",
    llm,
    tools: [listRecords, deleteRecord],
    system:
      "You are a database administrator. You can list and delete records. When asked to delete a record, use the delete_record tool immediately — approval is handled for you.",
    checkpointer: await getCheckpointer(),
    middleware: [
      humanInTheLoopMiddleware({
        interruptOn: {
          delete_record: {
            allowedDecisions: ["approve", "reject"],
            description: ({ args }) => `Delete record "${args.id}"? This cannot be undone.`,
          },
        },
      }),
    ],
  });
}
