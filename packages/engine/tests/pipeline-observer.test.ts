// @ci: unit
import { describe, it, expect, vi } from "vitest";
import { PipelineObserver } from "../src/pipeline-observer";
import { PipelinePriority, PipelineEventType, type ObservableEvent } from "@cortex/shared";

describe("PipelineObserver", () => {
  it("注册 handler 后 emit 被调用", () => {
    const po = new PipelineObserver();
    const handler = vi.fn();
    po.on(PipelinePriority.NORMAL, handler);
    const event: ObservableEvent = {
      type: PipelineEventType.NodeComplete,
      priority: PipelinePriority.NORMAL,
      payload: null,
      timestamp: Date.now(),
    };
    po.emit(event);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("只调用事件优先级匹配的 handler，不匹配的忽略", () => {
    const po = new PipelineObserver();
    const normalHandler = vi.fn();
    const criticalHandler = vi.fn();
    po.on(PipelinePriority.NORMAL, normalHandler);
    po.on(PipelinePriority.CRITICAL, criticalHandler);

    po.emit({
      type: PipelineEventType.NodeComplete,
      priority: PipelinePriority.NORMAL,
      payload: null,
      timestamp: Date.now(),
    });

    expect(normalHandler).toHaveBeenCalled();
    expect(criticalHandler).not.toHaveBeenCalled();
  });

  it("off 移除 handler 后不再调用", () => {
    const po = new PipelineObserver();
    const handler = vi.fn();
    po.on(PipelinePriority.NORMAL, handler);
    po.off(PipelinePriority.NORMAL);
    po.emit({
      type: PipelineEventType.NodeComplete,
      priority: PipelinePriority.NORMAL,
      payload: null,
      timestamp: Date.now(),
    });
    expect(handler).not.toHaveBeenCalled();
  });

  // ── P2-6 回归：requestId 幂等键 ──
  it("P2-6: emit auto-generates requestId for idempotent tracking", () => {
    const po = new PipelineObserver();
    const handler = vi.fn();
    po.on(PipelinePriority.NORMAL, handler);

    const event: ObservableEvent = {
      type: PipelineEventType.SchedulerDone,
      priority: PipelinePriority.NORMAL,
      payload: null,
      timestamp: Date.now(),
    };
    // 未提供 requestId
    expect(event.requestId).toBeUndefined();

    po.emit(event);

    // emit 后自动填充
    expect(event.requestId).toBeDefined();
    expect(event.requestId).toMatch(/^evt-\d+-[a-z0-9]+$/);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("P2-6: emit preserves caller-provided requestId", () => {
    const po = new PipelineObserver();
    const handler = vi.fn();
    po.on(PipelinePriority.CRITICAL, handler);

    const event: ObservableEvent = {
      type: PipelineEventType.NodeFailed,
      priority: PipelinePriority.CRITICAL,
      payload: null,
      timestamp: Date.now(),
      requestId: "custom-req-001",
    };

    po.emit(event);

    // 调用方提供的 requestId 不被覆盖
    expect(event.requestId).toBe("custom-req-001");
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("P2-6: successive emits generate unique requestIds", () => {
    const po = new PipelineObserver();
    const ids: string[] = [];
    po.on(PipelinePriority.HIGH, (e) => {
      ids.push(e.requestId!);
    });

    for (let i = 0; i < 5; i++) {
      po.emit({
        type: PipelineEventType.NodeStart,
        priority: PipelinePriority.HIGH,
        payload: null,
        timestamp: Date.now(),
      });
    }

    // 5 次 emit → 5 个不同的 requestId
    const unique = new Set(ids);
    expect(unique.size).toBe(5);
  });
});
