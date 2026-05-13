// @ci: unit
import { describe, it, expect } from "vitest";
import { ConfirmGate } from "../src/confirm-gate";
import { ReversibilityLevel } from "@cortex/shared";

describe("ConfirmGate", () => {
  it("L2/L3 需要确认", () => {
    const gate = new ConfirmGate();
    expect(gate.needsConfirmation(ReversibilityLevel.L2)).toBe(true);
    expect(gate.needsConfirmation(ReversibilityLevel.L3)).toBe(true);
  });

  it("L0/L1 不需要确认", () => {
    const gate = new ConfirmGate();
    expect(gate.needsConfirmation(ReversibilityLevel.L0)).toBe(false);
    expect(gate.needsConfirmation(ReversibilityLevel.L1)).toBe(false);
  });

  it("request → resolve 批准", () => {
    const gate = new ConfirmGate();
    gate.request({ id: "1", level: ReversibilityLevel.L2, toolName: "write", summary: "写文件" });
    expect(gate.hasPending()).toBe(true);
    const approved = gate.resolve({ requestId: "1", approved: true });
    expect(approved).toBe(true);
    expect(gate.hasPending()).toBe(false);
  });

  it("L1 超时默认拒绝", () => {
    const gate = new ConfirmGate();
    gate.request({ id: "2", level: ReversibilityLevel.L1, toolName: "write", summary: "写文件" });
    const result = gate.handleTimeout("2", ReversibilityLevel.L1);
    expect(result).toBe(false);
    expect(gate.hasPending()).toBe(false);
  });

  it("L2 超时阻塞（保留 pending）", () => {
    const gate = new ConfirmGate();
    gate.request({ id: "3", level: ReversibilityLevel.L2, toolName: "rm", summary: "删文件" });
    const result = gate.handleTimeout("3", ReversibilityLevel.L2);
    expect(result).toBe(false);
    expect(gate.hasPending()).toBe(true); // 保留请求，阻塞等待
  });
});
