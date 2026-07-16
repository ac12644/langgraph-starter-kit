import { describe, it, expect } from "vitest";
import { createHandoffTool } from "../../src/agents/handoff";

describe("createHandoffTool", () => {
  it("creates a tool with the correct name", () => {
    const handoff = createHandoffTool({ agentName: "alice" });
    expect(handoff.name).toBe("transfer_to_alice");
  });

  it("uses custom description when provided", () => {
    const handoff = createHandoffTool({
      agentName: "bob",
      description: "Get Bob to help with math",
    });
    expect(handoff.description).toBe("Get Bob to help with math");
  });

  it("uses default description when not provided", () => {
    const handoff = createHandoffTool({ agentName: "alice" });
    expect(handoff.description).toContain("alice");
  });
});
