import { describe, expect, it } from "vitest";
import { getPatternFiles, type Config } from "../../create-langgraph-app/create";

/**
 * The generated HTTP server must stop the agent when the client disconnects.
 * Without an abort signal, a closed tab keeps burning tokens until the graph
 * finishes. These tests check the emitted src/server.ts.
 */

const config: Config = {
  name: "abort-app",
  provider: "openai",
  patterns: ["supervisor", "swarm", "hitl", "structured", "rag"],
};

function generatedServer(): string {
  const file = getPatternFiles(config).find((f) => f.path === "src/server.ts");
  if (!file) throw new Error("scaffolder did not emit src/server.ts");
  return file.content;
}

describe("generated server /stream abort handling", () => {
  it("aborts the run when the client connection closes", () => {
    const server = generatedServer();
    expect(server).toContain("new AbortController()");
    expect(server).toMatch(
      /reply\.raw\.on\("close", \(\) => \{\s*if \(!reply\.raw\.writableFinished\) controller\.abort\(\);/
    );
  });

  it("passes the abort signal to app.stream()", () => {
    expect(generatedServer()).toMatch(
      /app\.stream\([^)]*streamMode: "messages", signal: controller\.signal/
    );
  });

  it("skips send() once the client is gone", () => {
    expect(generatedServer()).toMatch(
      /const send = \(e: unknown\) => \{\s*if \(controller\.signal\.aborted\) return;/
    );
  });

  it("does not report an abort as an error event", () => {
    expect(generatedServer()).toMatch(
      /catch \(err\) \{\s*if \(controller\.signal\.aborted\) return;\s*send\(\{ type: "error"/
    );
  });
});