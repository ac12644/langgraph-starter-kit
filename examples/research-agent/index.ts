/**
 * Research any topic, streamed token by token.
 *
 * The `npm run dev` demo researches a fixed topic and waits for the whole
 * answer. This takes the topic as an argument and streams, which is what you
 * want behind a UI.
 *
 *   npx tsx examples/research-agent/index.ts "your topic here"
 */
import "../../src/config/env";
import { AIMessageChunk } from "@langchain/core/messages";
import { createResearcherApp } from "../../src/apps/researcher";

const topic = process.argv.slice(2).join(" ") || "the LangGraph subagents pattern";

async function main() {
  const app = await createResearcherApp();

  console.log(`Researching: ${topic}\n`);

  // streamMode "messages" yields model tokens as they are produced, along with
  // the node that produced them — so you can show which agent is talking.
  const stream = await app.stream(
    { messages: [{ role: "user", content: `Research this and write a short report: ${topic}` }] },
    { configurable: { thread_id: "research-example" }, streamMode: "messages" },
  );

  let thinking = 0;
  for await (const [chunk] of stream) {
    if (!(chunk instanceof AIMessageChunk)) continue;

    // Reasoning models (qwen3, deepseek-reasoner, o-series) emit most of their
    // tokens as reasoning rather than answer content. Printing only `content`
    // makes the run look frozen for minutes, so show that work is happening.
    const reasoning = (chunk as { additional_kwargs?: { reasoning_content?: unknown } })
      .additional_kwargs?.reasoning_content;
    if (reasoning) {
      if (thinking++ % 20 === 0) process.stdout.write(".");
      continue;
    }

    if (typeof chunk.content === "string" && chunk.content) {
      if (thinking) {
        process.stdout.write("\n\n");
        thinking = 0;
      }
      process.stdout.write(chunk.content);
    }
  }

  console.log("\n");
  if (thinking) console.log("(dots above were reasoning tokens, not stalls.)");
  console.log("Note: this app caps model calls (see src/apps/researcher.ts) so a");
  console.log("vague topic cannot loop it indefinitely.");
}

main().catch((err) => {
  console.error("Example failed:", err);
  process.exit(1);
});
