import { ChatOpenAI } from "@langchain/openai";
import { LLM_MODEL, LLM_TEMPERATURE } from "./env";

export const llm = new ChatOpenAI({
  modelName: LLM_MODEL,
  temperature: LLM_TEMPERATURE,
});
