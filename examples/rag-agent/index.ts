/**
 * RAG over your own documents.
 *
 * The `npm run dev` demo indexes SAMPLE_DOCS. This shows the thing you
 * actually want: swapping in your own corpus.
 *
 *   npx tsx examples/rag-agent/index.ts
 */
import "../../src/config/env";
import { initRagStore, createRagApp } from "../../src/apps/rag";

// Replace with your own content — loaded from files, a CMS, a database, wherever.
// Anything that ends up as strings works; chunking and embedding are handled for you.
const MY_DOCS = [
  `Acme Corp refund policy: customers may request a full refund within 30 days of
   purchase. Refunds are issued to the original payment method and take 5-10
   business days to appear. Digital goods are non-refundable once downloaded.`,

  `Acme Corp shipping: standard delivery is 3-5 business days within the continental
   US. Express delivery is next business day if ordered before 2pm ET. We do not
   currently ship to PO boxes or internationally.`,

  `Acme Corp warranty: hardware carries a 2-year limited warranty covering
   manufacturing defects. Accidental damage is not covered. Warranty claims require
   the original order number and proof of purchase.`,
];

const QUESTIONS = [
  // Answerable from one document.
  "How long do I have to return something, and how do refunds get paid back?",
  // Answerable, but only if retrieval surfaces the shipping document rather than
  // the refund one — a useful check on whether your corpus and chunking work.
  "Can you ship to a PO box?",
  // Genuinely absent from the corpus. A grounded agent should say so.
  "What is the parental leave policy?",
];

async function main() {
  // Index first, then hand the store to the app. initRagStore() is memoized, so
  // building it explicitly avoids depending on call order.
  const store = await initRagStore(MY_DOCS);
  const app = await createRagApp(store);

  for (const question of QUESTIONS) {
    console.log(`\nQ: ${question}`);
    const result = await app.invoke(
      { messages: [{ role: "user", content: question }] },
      { configurable: { thread_id: "rag-example" } },
    );

    const used = result.messages.some((m) => m.getType() === "tool");
    console.log(`A: ${result.messages.at(-1)?.content}`);
    console.log(`   (knowledge base searched: ${used ? "yes" : "no"})`);
  }

  console.log("\nThe last question is not covered by these documents. A grounded");
  console.log("agent should say so rather than inventing a policy — if yours invents");
  console.log("one, tighten the system prompt in src/apps/rag.ts.");
}

main().catch((err) => {
  console.error("Example failed:", err);
  process.exit(1);
});
