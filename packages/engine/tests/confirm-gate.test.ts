// @ci: unit
import { describe, it, expect } from "vitest";
import { ConfirmGate } from "@cortex/scheduler";
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

  // M1: L2/L3 超时也会移除 pending，防止内存泄漏
  it("L2 超时移除 pending（M1 修复）", () => {
    const gate = new ConfirmGate();
    gate.request({ id: "3", level: ReversibilityLevel.L2, toolName: "rm", summary: "删文件" });
    const result = gate.handleTimeout("3", ReversibilityLevel.L2);
    expect(result).toBe(false);
    expect(gate.hasPending()).toBe(false); // M1: 超时后也移除 pending
  });

  // ── P2: 超时默认值可配置 ──

  it("构造函数接受 timeoutMs 参数（P2 修复）", () => {
    const gate = new ConfirmGate(5_000);
    expect(gate).toBeInstanceOf(ConfirmGate);
    // 基本功能不受影响
    gate.request({ id: "p2-1", level: ReversibilityLevel.L2, toolName: "write", summary: "写文件" });
    expect(gate.hasPending()).toBe(true);
    const approved = gate.resolve({ requestId: "p2-1", approved: true });
    expect(approved).toBe(true);
    expect(gate.hasPending()).toBe(false);
  });

  it("waitFor 传入 timeoutMs 优先于默认值（P2 修复）", async () => {
    const gate = new ConfirmGate();
    const reqId = gate.request({
      id: "p2-2",
      level: ReversibilityLevel.L2,
      toolName: "write",
      summary: "写文件"});
    // 显式传入 timeoutMs，应优先于构造函数的默认值
    const promise = gate.waitFor(reqId, 60_000);
    const approved = gate.resolve({ requestId: reqId, approved: true });
    const result = await promise;
    expect(result).toBe(true);
    expect(gate.hasPending()).toBe(false);
  });

  it("构造函数 timeoutMs 影响 waitFor 默认超时（P2 修复）", async () => {
    const gate = new ConfirmGate(10_000);
    const reqId = gate.request({
      id: "p2-3",
      level: ReversibilityLevel.L2,
      toolName: "write",
      summary: "写文件"});
    // 不传 timeoutMs，应使用构造函数传入的 10_000
    const promise = gate.waitFor(reqId);
    const approved = gate.resolve({ requestId: reqId, approved: true });
    const result = await promise;
    expect(result).toBe(true);
    expect(gate.hasPending()).toBe(false);
  });
});
