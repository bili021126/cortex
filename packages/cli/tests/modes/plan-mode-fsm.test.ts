// @ci: unit
import { describe, it, expect } from "vitest";
import { canTransition, reviewStatusToFsmState } from "../../src/tui/modes/plan-mode.js";

describe("PlanModeState FSM", () => {
  it("idle → planning 合法", () => {
    expect(canTransition("idle", "planning")).toBe(true);
  });

  it("idle → reviewing 非法", () => {
    expect(canTransition("idle", "reviewing")).toBe(false);
  });

  it("planning → reviewing 合法", () => {
    expect(canTransition("planning", "reviewing")).toBe(true);
  });

  it("planning → idle 合法（取消）", () => {
    expect(canTransition("planning", "idle")).toBe(true);
  });

  it("reviewing → approved 合法", () => {
    expect(canTransition("reviewing", "approved")).toBe(true);
  });

  it("reviewing → executing 非法（需先 approved）", () => {
    expect(canTransition("reviewing", "executing")).toBe(false);
  });

  it("approved → executing 合法", () => {
    expect(canTransition("approved", "executing")).toBe(true);
  });

  it("executing → completed 合法", () => {
    expect(canTransition("executing", "completed")).toBe(true);
  });

  it("executing → failed 合法", () => {
    expect(canTransition("executing", "failed")).toBe(true);
  });

  it("executing → aborted 合法", () => {
    expect(canTransition("executing", "aborted")).toBe(true);
  });

  it("completed → idle 合法（重置）", () => {
    expect(canTransition("completed", "idle")).toBe(true);
  });

  it("failed → idle 合法", () => {
    expect(canTransition("failed", "idle")).toBe(true);
  });

  it("idle → executing 非法（跳状态）", () => {
    expect(canTransition("idle", "executing")).toBe(false);
  });

  it("approved → planning 非法（不能回退）", () => {
    expect(canTransition("approved", "planning")).toBe(false);
  });

  it("未知状态转移非法", () => {
    expect(canTransition("unknown", "idle")).toBe(false);
  });

  it("reviewStatusToFsmState pending → idle", () => {
    expect(reviewStatusToFsmState("pending")).toBe("idle");
  });

  it("reviewStatusToFsmState reviewing → planning", () => {
    expect(reviewStatusToFsmState("reviewing")).toBe("planning");
  });

  it("reviewStatusToFsmState reviewed → reviewing", () => {
    expect(reviewStatusToFsmState("reviewed")).toBe("reviewing");
  });

  it("reviewStatusToFsmState 未知 → idle", () => {
    expect(reviewStatusToFsmState("unknown")).toBe("idle");
  });
});
