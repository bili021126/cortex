/**
 * ConfirmGate 测试 —— 修复 M1：handleTimeout L2/L3 回收 pending
 *
 * 验证点：
 * 1. handleTimeout L0/L1 移除 pending（现有行为）
 * 2. handleTimeout L2/L3 也移除 pending（M1 修复）
 * 3. hasPending() 在 timeout 后返回 false
 */
import { describe, it, expect } from "vitest";
import { ConfirmGate } from "../src/confirm-gate.js";
import { ReversibilityLevel as RL } from "@cortex/shared";

describe("M1: ConfirmGate handleTimeout 回收 pending", () => {
  it("L0 timeout 移除 pending 并返回 false", () => {
    const gate = new ConfirmGate();
    const reqId = gate.request({
      id: "test-1",
      level: RL.L0,
      toolName: "read_file",
      summary: "test",
    });
    expect(gate.hasPending()).toBe(true);

    const result = gate.handleTimeout(reqId, RL.L0);
    expect(result).toBe(false);
    expect(gate.hasPending()).toBe(false);
  });

  it("L1 timeout 移除 pending 并返回 false", () => {
    const gate = new ConfirmGate();
    const reqId = gate.request({
      id: "test-2",
      level: RL.L1,
      toolName: "write_file",
      summary: "test",
    });
    expect(gate.hasPending()).toBe(true);

    const result = gate.handleTimeout(reqId, RL.L1);
    expect(result).toBe(false);
    expect(gate.hasPending()).toBe(false);
  });

  it("L2 timeout 也移除 pending（M1 修复）", () => {
    const gate = new ConfirmGate();
    const reqId = gate.request({
      id: "test-3",
      level: RL.L2,
      toolName: "delete_file",
      summary: "test",
    });
    expect(gate.hasPending()).toBe(true);

    const result = gate.handleTimeout(reqId, RL.L2);
    expect(result).toBe(false);
    expect(gate.hasPending()).toBe(false);
  });

  it("L3 timeout 也移除 pending（M1 修复）", () => {
    const gate = new ConfirmGate();
    const reqId = gate.request({
      id: "test-4",
      level: RL.L3,
      toolName: "run_shell",
      summary: "test",
    });
    expect(gate.hasPending()).toBe(true);

    const result = gate.handleTimeout(reqId, RL.L3);
    expect(result).toBe(false);
    expect(gate.hasPending()).toBe(false);
  });

  it("未知 requestId 的 handleTimeout 返回 false 且不报错", () => {
    const gate = new ConfirmGate();
    const result = gate.handleTimeout("non-existent", RL.L2);
    expect(result).toBe(false);
  });
});
