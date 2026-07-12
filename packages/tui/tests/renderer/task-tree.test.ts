// @ci: unit
import { describe, it, expect } from "vitest";
import { TaskTreeRenderer } from "../../src/renderer/task-tree.js";

describe("TaskTreeRenderer (skeleton — v4 退役)", () => {
  it("render 始终为空数组", () => {
    const tt = new TaskTreeRenderer();
    expect(tt.render(80).length).toBe(0);
  });
  it("handleEvent 不抛异常", () => {
    const tt = new TaskTreeRenderer();
    expect(() => tt.handleEvent({ type: "node_start", nodeId: "n1", nodeType: "test", agent: "code" as any, description: "test" })).not.toThrow();
  });
  it("clear 不抛异常", () => {
    const tt = new TaskTreeRenderer();
    expect(() => tt.clear()).not.toThrow();
  });
});
