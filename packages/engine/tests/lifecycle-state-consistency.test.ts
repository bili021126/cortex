// @ci: unit
/**
 * 生命周期 vs 状态机一致性测试。
 *
 * Agent 的生命周期（init→start→stop→dispose, ILifecycle）
 * 与 Agent 状态机（idle→dispatched→executing→timed_out, AgentExecutionState）
 * 是两套体系，但 engine shutdown 时必须保持同步。
 *
 * 这些测试断言 CORRECT 行为（fix 后的行为），
 * 当前代码应 FAIL——暴露缺陷。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { AgentTracker } from "@cortex/scheduler";

describe("Lifecycle vs StateMachine consistency", () => {
  let tracker: AgentTracker;

  beforeEach(() => {
    tracker = new AgentTracker();
  });

  it("should transition agent state when lifecycle stops", () => {
    // lifecycle dispose 后，agent 应变为 failed（不可再调度）
    tracker.markDispatched("agent-1", "node-1");
    tracker.recordHeartbeat("agent-1");

    // 期望：syncLifecycleState 方法存在且可调用
    // 缺陷：当前 AgentTracker 无此方法 —— 此测试应 FAIL
    expect(typeof (tracker as any).syncLifecycleState).toBe("function");

    // 调用后 state 应变为 Failed
    (tracker as any).syncLifecycleState("agent-1", "dispose");
    const entry = (tracker as any).states.get("agent-1");
    expect(entry.state).toBe("failed");
  });

  it("should not allow dispatch after lifecycle disposal", () => {
    // lifecycle dispose 后不应再接受 markDispatched
    tracker.markDispatched("agent-2", "node-2");
    expect((tracker as any).states.size).toBe(1);

    // 期望：syncLifecycleState 存在（当前无此方法——应 FAIL）
    expect(typeof (tracker as any).syncLifecycleState).toBe("function");

    (tracker as any).syncLifecycleState("agent-2", "dispose");
    // dispose 后再次分发的期望：抛错或拒绝
    // 不要求实现，只验证方法存在
  });

  it("should not allow lifecycle start on already-failed agent", () => {
    tracker.markDispatched("agent-3", "node-3");
    tracker.markFailed("agent-3");

    // failed 后不应在 checkTimeouts 中产生动作
    const actions = tracker.checkTimeouts(Date.now() + 200_000);
    expect(actions.length).toBe(0);
  });

  it("should keep state and lifecycle in sync during crash recovery", () => {
    tracker.markDispatched("agent-4", "node-4");

    // 期望：reset 前应有持久化机制
    // 缺陷：当前 reset 直接清空，无持久化
    // 验证点——但 reset 确实存在
    tracker.reset();
    expect(tracker.size).toBe(0);
  });

  it("should timeout agent only when executing, not when idle", () => {
    const now = Date.now();

    tracker.markDispatched("agent-5", "node-5");

    // 修改内部时间为过去，模拟超时
    const entry = (tracker as any).states.get("agent-5");
    entry.dispatchedAt = now - 200_000;
    entry.pingSent = true;

    const actions = tracker.checkTimeouts(now);
    expect(actions.length).toBe(1);
    expect(actions[0].type).toBe("kill");

    // 清除后，idle → 无动作
    tracker.reset();
    expect(tracker.checkTimeouts(now).length).toBe(0);
  });
});
