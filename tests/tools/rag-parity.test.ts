import { afterAll, describe, expect, it } from "vitest";
import { InMemoryVectorStore, buildVectorStore } from "../../src/tools/rag";
import type { Embeddings } from "@langchain/core/embeddings";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPatternFiles, type Config } from "../../create-langgraph-app/create";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function createParityEmbeddings(): Embeddings {
  function embed(text: string): number[] {
    const lower = text.toLowerCase();
    if (lower.includes("zero")) return [0, 0];
    if (lower.includes("alpha")) return [1, 0];
    if (lower.includes("beta")) return [0, 1];
    return [1, 1];
  }

  return {
    embedDocuments: async (texts: string[]) => texts.map(embed),
    embedQuery: async (text: string) => embed(text),
  } as unknown as Embeddings;
}

async function loadGeneratedRag() {
  const dir = fs.mkdtempSync(path.join(repoRoot, ".tmp-rag-parity-"));
  tempDirs.push(dir);
  const ragPath = path.join(dir, "src", "tools", "rag.ts");
  fs.mkdirSync(path.dirname(ragPath), { recursive: true });

  const config: Config = { name: "parity-test", provider: "openai", patterns: ["rag"] };
  const ragFile = getPatternFiles(config).find((file) => file.path === "src/tools/rag.ts");
  if (!ragFile) throw new Error("RAG template was not generated");
  fs.writeFileSync(ragPath, ragFile.content);

  return import(`${pathToFileURL(ragPath).href}?parity=${Date.now()}`);
}

describe("RAG kit and scaffolder parity", () => {
  it("returns identical rankings, including zero-vector documents", async () => {
    const generated = await loadGeneratedRag();
    const documents = ["zero vector document", "alpha document", "beta document"];

    const kitStore = await buildVectorStore(
      createParityEmbeddings(),
      documents,
      1_000,
      0,
    );
    const scaffoldedStore = await generated.buildVectorStore(
      createParityEmbeddings(),
      documents,
      1_000,
      0,
    );

    expect(kitStore.size).toBe(scaffoldedStore.size);
    const alphaResults = await kitStore.search("alpha", 3);
    await expect(scaffoldedStore.search("alpha", 3)).resolves.toEqual(alphaResults);
    expect(alphaResults).toEqual([
      "alpha document",
      "zero vector document",
      "beta document",
    ]);

    await expect(scaffoldedStore.search("zero", 3)).resolves.toEqual(
      await kitStore.search("zero", 3),
    );
  });
});
