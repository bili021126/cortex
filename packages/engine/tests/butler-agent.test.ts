import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentType, AgentStatus, PipelinePriority } from "@cortex/shared";
import type { ObservableEvent } from "@cortex/shared";
import { PipelineObserver } from "../src/pipeline-observer";
import { ButlerAgent } from "../src/butler-agent";

function makeEvent(type: string, priority: PipelinePriority, payload: Record<string, unknown> = {}): ObservableEvent {
  return { type, priority, payload: payload as any, timestamp: Date.now() };
}

describe("ButlerAgent", () => {
  let observer: PipelineObserver;
  let agent: ButlerAgent;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    observer = new PipelineObserver();
    agent = new ButlerAgent(observer);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  // ── 状态机 ──────────────────────────────────

  it("初始状态为 Created", () => {
    expect(agent.status).toBe(AgentStatus.Created);
    expect(agent.type).toBe(AgentType.Butler);
  });

  it("wakeup → 订阅 CRITICAL/HIGH/NORMAL 事件，状态变为 Awake", async () => {
    await agent.wakeup();
    expect(agent.status).toBe(AgentStatus.Awake);
  });

  it("shutdown → 退订事件，状态变为 Destroyed", async () => {
    await agent.wakeup();
    await agent.shutdown();
    expect(agent.status).toBe(AgentStatus.Destroyed);
  });

  it("execute 返回 noop 结果（管家不执行任务）", async () => {
    const result = await agent.execute();
    expect(result.success).toBe(true);
    expect(result.output).toContain("ButlerAgent does not execute tasks");
    expect(result.nodeId).toBe("butler-noop");
  });

  // ── CRITICAL 事件处理 ────────────────────────

  it("CRITICAL: node.failed → 格式化失败消息", async () => {
    await agent.wakeup();
    observer.emit(makeEvent("node.failed", PipelinePriority.CRITICAL, {
      nodeId: "n1",
      error: "LLM timeout",
    }));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Butler-CRITICAL]"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("n1"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("LLM timeout"),
    );
  });

  it("CRITICAL: node.replan → 格式化重规划消息", async () => {
    await agent.wakeup();
    observer.emit(makeEvent("node.replan", PipelinePriority.CRITICAL, {
      nodeId: "n2",
      reason: "CodeAgent failed",
      attempt: 2,
    }));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Butler-CRITICAL]"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("n2"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("2"),
    );
  });

  it("CRITICAL: scheduler.done → 格式化管线完成摘要", async () => {
    await agent.wakeup();
    observer.emit(makeEvent("scheduler.done", PipelinePriority.CRITICAL, {
      total: 5,
      completed: 4,
      failed: 1,
      durationMs: 1234,
    }));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Butler-CRITICAL]"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("4"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("5"),
    );
  });

  // ── HIGH 事件处理 ────────────────────────────

  it("HIGH: node.start → 格式化节点开始消息", async () => {
    await agent.wakeup();
    observer.emit(makeEvent("node.start", PipelinePriority.HIGH, {
      nodeId: "n3",
      type: "implementation",
    }));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Butler]"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("n3"),
    );
  });

  it("HIGH: node.complete → 格式化节点完成消息", async () => {
    await agent.wakeup();
    observer.emit(makeEvent("node.complete", PipelinePriority.HIGH, {
      nodeId: "n4",
      agentType: "code",
      success: true,
    }));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Butler]"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("n4"),
    );
  });

  it("HIGH: scheduler.layer.start → 格式化层开始消息", async () => {
    await agent.wakeup();
    observer.emit(makeEvent("scheduler.layer.start", PipelinePriority.HIGH, {
      layer: 2,
      nodes: 3,
    }));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Butler]"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("2"),
    );
  });

  // ── shutdown 后退订 ───────────────────────────

  it("shutdown 后不再接收事件", async () => {
    await agent.wakeup();
    await agent.shutdown();

    consoleSpy.mockClear();
    observer.emit(makeEvent("node.failed", PipelinePriority.CRITICAL, {
      nodeId: "silent",
      error: "should not be logged",
    }));

    // 退订后不应有任何输出
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  // ── 未知事件类型不应抛异常 ────────────────────

  it("未知事件类型应兜底 JSON 格式化", async () => {
    await agent.wakeup();
    // 不应抛异常
    expect(() => {
      observer.emit(makeEvent("unknown.event", PipelinePriority.CRITICAL, { foo: "bar" }));
    }).not.toThrow();
  });
});
