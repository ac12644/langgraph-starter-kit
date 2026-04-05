import { llm } from "../config/llm";
import { createEmbeddings } from "../config/embeddings";
import { makeAgent } from "../agents/factory";
import { makeSupervisor } from "../agents/supervisor";
import {
  buildVectorStore,
  createRetrievalTool,
  SAMPLE_DOCS,
  type InMemoryVectorStore,
} from "../tools/rag";

let _vectorStore: InMemoryVectorStore | null = null;

/**
 * Initialize the RAG vector store with sample documents.
 * Call this before creating the RAG app. Safe to call multiple times.
 */
export async function initRagStore(
  customDocs?: string[],
): Promise<InMemoryVectorStore> {
  if (_vectorStore) return _vectorStore;

  const embeddings = createEmbeddings();
  _vectorStore = await buildVectorStore(embeddings, customDocs ?? SAMPLE_DOCS);
  console.log(`RAG: indexed ${_vectorStore.size} chunks`);
  return _vectorStore;
}

export function createRagApp(vectorStore: InMemoryVectorStore) {
  const retrievalTool = createRetrievalTool(vectorStore);

  const ragAgent = makeAgent({
    name: "rag_agent",
    llm,
    tools: [retrievalTool],
    system: [
      "You are a knowledgeable assistant with access to a knowledge base.",
      "ALWAYS search the knowledge base before answering questions.",
      "Base your answers on the retrieved documents. If the knowledge base",
      "doesn't contain relevant information, say so clearly.",
      "Cite which parts of the retrieved context support your answer.",
    ].join("\n"),
  });

  return makeSupervisor({
    agents: [ragAgent],
    llm,
    outputMode: "last_message",
    supervisorName: "rag_supervisor",
  });
}
