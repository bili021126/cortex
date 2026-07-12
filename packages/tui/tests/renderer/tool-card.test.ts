// @ci: unit
import { describe, it, expect } from "vitest";
import { ToolCard } from "../../src/renderer/tool-card.js";

describe("ToolCard (skeleton — v4 退役)", () => {
  it("方法不抛异常", () => {
    const tc = new ToolCard();
    expect(() => tc.add("t1", "read_file")).not.toThrow();
    expect(() => tc.complete("t1", "file content here", 123, true)).not.toThrow();
    expect(() => tc.toggle("t1")).not.toThrow();
    expect(() => tc.clear()).not.toThrow();
    expect(() => tc.reset()).not.toThrow();
  });

  it("render 返回空数组（骨架）", () => {
    const tc = new ToolCard();
    expect(tc.render(80).length).toBe(0);
    tc.add("t1", "read_file");
    tc.complete("t1", "data", 10, true);
    expect(tc.render(80).length).toBe(0);
  });

  it("clear 不抛异常", () => {
    const tc = new ToolCard();
    tc.add("t1", "read_file");
    expect(() => tc.clear()).not.toThrow();
  });

  it("reset 不抛异常", () => {
    const tc = new ToolCard();
    tc.add("t1", "read_file");
    expect(() => tc.reset()).not.toThrow();
  });
});
