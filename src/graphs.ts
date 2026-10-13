import { createSwarmApp } from "./apps/swarm";
import { createSupervisorApp } from "./apps/supervisor";
import { createInterruptApp } from "./apps/interrupt";
import { createAnalystApp } from "./apps/analyst";
import { createResearcherApp } from "./apps/researcher";
import { createRagApp } from "./apps/rag";
import { createSupportApp } from "./apps/support";

/**
 * Zero-argument graph entries for langgraph.json.
 *
 * The LangGraph API server calls factories as factory(config, runtime), so a
 * factory whose first parameter means something else (mcpTools, vectorStore)
 * would receive the config object. These wrappers ignore everything the loader
 * passes; the HTTP server keeps using the original factories directly.
 */
export const swarm = () => createSwarmApp();
export const supervisor = () => createSupervisorApp();
export const interrupt = () => createInterruptApp();
export const analyst = () => createAnalystApp();
export const researcher = () => createResearcherApp();
export const rag = () => createRagApp();
export const support = () => createSupportApp();