import { describe, it, expect, vi } from "vitest";
import { PipelineObserver } from "../src/pipeline-observer";
import { PipelinePriority, ObservableEvent } from "@cortex/shared";

describe("PipelineObserver", () => {
  it("注册 handler 后 emit 被调用", () => {
    const po = new PipelineObserver();
    const handler = vi.fn();
    po.on(PipelinePriority.NORMAL, handler);
    const event: ObservableEvent = {
      type: "test",
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
      type: "test",
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
      type: "test",
      priority: PipelinePriority.NORMAL,
      payload: null,
      timestamp: Date.now(),
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
