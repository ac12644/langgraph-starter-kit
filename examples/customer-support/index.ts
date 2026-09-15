/**
 * A support conversation that spans several turns and pauses for approval.
 *
 * The `npm run dev` demo sends one message. This shows the two things that
 * actually matter in production: memory across turns on a thread, and a
 * human-in-the-loop interrupt you resume later.
 *
 *   npx tsx examples/customer-support/index.ts
 */
import "../../src/config/env";
import { Command } from "@langchain/langgraph";
import { createSupportApp } from "../../src/apps/support";

// One thread id = one conversation. Reuse it and the agent remembers; change it
// and you get a clean slate.
const THREAD = { configurable: { thread_id: "support-example" } };

interface PendingInterrupt {
  value?: { message?: string } & Record<string, unknown>;
}

/** getState's generics don't narrow here; this is the slice we actually read. */
interface PausedState {
  tasks?: { interrupts?: PendingInterrupt[] }[];
}

function lastText(messages: { content: unknown }[]): string {
  const c = messages.at(-1)?.content;
  return typeof c === "string" ? c : JSON.stringify(c);
}

async function main() {
  const app = await createSupportApp();

  // --- Turn 1: establish who the customer is ---
  console.log("\n> Hi, I'm customer C-1002. What am I being charged for?");
  let result = await app.invoke(
    { messages: [{ role: "user", content: "Hi, I'm customer C-1002. What am I being charged for?" }] },
    THREAD,
  );
  console.log(lastText(result.messages));

  // --- Turn 2: no customer id this time; it has to remember ---
  console.log("\n> That charge is wrong. I want it refunded.");
  result = await app.invoke(
    { messages: [{ role: "user", content: "That charge is wrong. I want it refunded." }] },
    THREAD,
  );

  // Refunds and escalations call interrupt(), which pauses the whole graph.
  const state = (await app.getState(THREAD)) as PausedState;
  const interrupts = (state.tasks ?? []).flatMap((t) => t.interrupts ?? []);

  if (interrupts.length === 0) {
    console.log(lastText(result.messages));
    console.log("\n(No approval was requested this run — models vary in when they escalate.)");
    return;
  }

  // --- Paused: this is where a real app would notify a human ---
  console.log("\n--- PAUSED, waiting for a human ---");
  for (const i of interrupts) {
    console.log(`  ${i.value?.message ?? JSON.stringify(i.value)}`);
  }

  // --- Resume with the decision. "no" would flow back just as cleanly. ---
  console.log('\n--- Approving with "yes" ---');
  const resumed = await app.invoke(new Command({ resume: "yes" }), THREAD);
  console.log(lastText(resumed.messages));

  console.log("\nThe whole graph paused mid-tool-call and picked up exactly where it");
  console.log("left off — state came from the checkpointer, not from replaying.");
}

main().catch((err) => {
  console.error("Example failed:", err);
  process.exit(1);
});
