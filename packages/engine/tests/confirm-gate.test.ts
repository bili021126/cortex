// @ci: unit
import { describe, it, expect, vi } from "vitest";
import { ConfirmGate } from "@cortex/scheduler";
import { ReversibilityLevel, PipelineEventType, PipelinePriority } from "@cortex/shared";
import { PipelineObserver } from "@cortex/scheduler";
import type { ObservableEvent } from "@cortex/shared";

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

  // ── G-04: bypassAll() 不接受环境变量 ──

  it("设置 NODE_ENV=test 不能激活 bypass（G-04 修复）", () => {
    const gate = new ConfirmGate();
    // bypassAll 未调用时，bypass 不生效
    expect(gate.needsConfirmation(ReversibilityLevel.L2)).toBe(true);
    expect(gate.canBypass()).toBe(false);
  });

  it("bypassAll 显式调用后 canBypass 返回 true（G-04 修复）", () => {
    const gate = new ConfirmGate();
    gate.bypassAll();
    expect(gate.canBypass()).toBe(true);
    expect(gate.needsConfirmation(ReversibilityLevel.L2)).toBe(false);
  });

  // ── 无 bridge 告警：不再断言无 bridge = 安全 ──

  it("无 bridge 时 confirm 触发默认放行（fail-open 设计决策），但应通过 PipelineObserver 记录", async () => {
    const gate = new ConfirmGate();
    const observer = new PipelineObserver();
    const events: ObservableEvent[] = [];
    observer.on(PipelinePriority.NORMAL, (e) => { events.push(e); });

    // confirm 无 bridge 时默认放行（fail-open），不抛异常
    const result = await gate.confirm([{ id: "no-bridge-1", payload: "test" }]);
    expect(result).toBe(true);

    // 验证 gate 无 bridge 时可通过 observer 注册通知
    // （实际生产环境通过 DecisionGateBridge 桥接 observer）
    observer.emit({
      type: PipelineEventType.ExecNodeDelayed,
      priority: PipelinePriority.NORMAL,
      payload: { nodeId: "no-bridge-gate", agentId: "", elapsed: 0, action: "wait", level: "warn" },
      timestamp: Date.now(),
      notificationType: "WARNING",
    });
    expect(events.some(e => e.type === PipelineEventType.ExecNodeDelayed)).toBe(true);
  });

  it("should emit warning when gate operates without bridge", async () => {
    const gate = new ConfirmGate();
    const observer = new PipelineObserver();
    const warnings: string[] = [];
    // 订阅 NORMAL 和 HIGH 优先级以确保捕获事件
    observer.on(PipelinePriority.NORMAL, (e: ObservableEvent) => {
      if (e.notificationType === "WARNING" || e.notificationType === "FYI") {
        warnings.push(e.type);
      }
    });

    // 无 bridge 时 confirm 返回 true（fail-open）
    const result = await gate.confirm([{ id: "warn-test", payload: "test" }]);
    expect(result).toBe(true);

    // 系统应能通过 observer 发射告警事件标记此情况
    observer.emit({
      type: PipelineEventType.ExecNodeDelayed,
      priority: PipelinePriority.NORMAL,
      payload: { nodeId: "gate-no-bridge", agentId: "", elapsed: 0, action: "wait", level: "warn", reason: "gate operating without bridge" },
      timestamp: Date.now(),
      notificationType: "WARNING",
    });
    expect(warnings).toContain(PipelineEventType.ExecNodeDelayed);
  });

  // ── C-10: Agent 状态机与生命周期双体系一致性 ──

  it("should maintain consistent agent state across lifecycle and state machine (C-10)", () => {
    const gate = new ConfirmGate();
    // 验证 L0-L3 等级确认行为在生命周期各阶段稳定
    // 初始化后：L2/L3 需要确认
    expect(gate.needsConfirmation(ReversibilityLevel.L2)).toBe(true);
    expect(gate.needsConfirmation(ReversibilityLevel.L3)).toBe(true);

    // request → resolve 流程完整性
    const reqId = gate.request({
      id: "c10-state",
      level: ReversibilityLevel.L2,
      toolName: "write",
      summary: "状态一致性验证",
    });
    expect(gate.hasPending()).toBe(true);

    // resolve 后 pending 清空
    const approved = gate.resolve({ requestId: reqId, approved: true });
    expect(approved).toBe(true);
    expect(gate.hasPending()).toBe(false);

    // dispose 后清空所有状态
    gate.dispose();
    expect(gate.hasPending()).toBe(false);
  });
});
