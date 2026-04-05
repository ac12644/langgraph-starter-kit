import { describe, it, expect } from "vitest";
import { add, multiply, echo } from "../../src/tools/local";

describe("local tools", () => {
  it("add returns sum of two numbers", async () => {
    const result = await add.invoke({ a: 3, b: 7 });
    expect(result).toBe("10");
  });

  it("add handles negative numbers", async () => {
    const result = await add.invoke({ a: -5, b: 3 });
    expect(result).toBe("-2");
  });

  it("multiply returns product of two numbers", async () => {
    const result = await multiply.invoke({ a: 4, b: 5 });
    expect(result).toBe("20");
  });

  it("multiply handles zero", async () => {
    const result = await multiply.invoke({ a: 100, b: 0 });
    expect(result).toBe("0");
  });

  it("echo returns the input text", async () => {
    const result = await echo.invoke({ text: "hello world" });
    expect(result).toBe("hello world");
  });

  it("echo handles empty string", async () => {
    const result = await echo.invoke({ text: "" });
    expect(result).toBe("");
  });
});
