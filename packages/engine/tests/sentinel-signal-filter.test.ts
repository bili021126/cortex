// @ci: unit
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PipelineEventType, PipelinePriority, type ObservableEvent } from "@cortex/shared";
import { SentinelSignalFilter } from "@cortex/engine";
import type { FilteredSignal } from "@cortex/engine";

/** 构造测试用 ObservableEvent */
function makeEvent(overrides: Partial<ObservableEvent> = {}): any {
  return {
    type: PipelineEventType.NodeComplete,
    priority: PipelinePriority.NORMAL,
    payload: { nodeId: "n1", agentType: "code", success: true },
    timestamp: Date.now(),
    requestId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ...overrides,
  };
}

describe("SentinelSignalFilter", () => {
  let filter: SentinelSignalFilter;

  beforeEach(() => {
    filter = new SentinelSignalFilter({
      deduplicationWindowMs: 5000,
      l3SampleRate: 1.0, // 100% 采样，确保测试确定性
      alertStormThreshold: 5,
    });
  });

  describe("filter() 信号分层", () => {
    it("L1 事件类型 → 返回 L1 信号", () => {
      const event = makeEvent({
        type: PipelineEventType.SchedulerLoopCrashed,
        priority: PipelinePriority.CRITICAL,
      });

      const signal = filter.filter(event);
      expect(signal).not.toBeNull();
      expect(signal!.level).toBe("L1");
      expect(signal!.requiresImmediateAction).toBe(true);
      expect(signal!.suggestedAction).toBe("alert");
    });

    it("L2 事件类型 → 返回 L2 信号", () => {
      const event = makeEvent({
        type: PipelineEventType.ErrorSilentUpgraded,
        priority: PipelinePriority.HIGH,
      });

      const signal = filter.filter(event);
      expect(signal).not.toBeNull();
      expect(signal!.level).toBe("L2");
      expect(signal!.requiresImmediateAction).toBe(false);
      expect(signal!.suggestedAction).toBe("log");
    });

    it("普通事件类型 → 返回 L3 信号（100% 采样率下）", () => {
      const event = makeEvent({
        type: PipelineEventType.NodeComplete,
        priority: PipelinePriority.NORMAL,
      });

      const signal = filter.filter(event);
      expect(signal).not.toBeNull();
      expect(signal!.level).toBe("L3");
      expect(signal!.suggestedAction).toBe("sample");
    });

    it("L3 采样率为 0 → 不返回 L3 信号", () => {
      const strictFilter = new SentinelSignalFilter({
        l3SampleRate: 0,
        deduplicationWindowMs: 5000,
      });

      const event = makeEvent({
        type: PipelineEventType.NodeComplete,
        priority: PipelinePriority.NORMAL,
      });

      const signal = strictFilter.filter(event);
      expect(signal).toBeNull();
    });
  });

  describe("去噪机制", () => {
    it("同类事件在窗口内被抑制（L2）", () => {
      const event = makeEvent({
        type: PipelineEventType.ErrorSilentUpgraded,
        priority: PipelinePriority.HIGH,
      });

      // 第一次应返回
      const signal1 = filter.filter(event);
      expect(signal1).not.toBeNull();

      // 窗口内第二次应被抑制
      const signal2 = filter.filter(event);
      expect(signal2).toBeNull();
    });

    it("L1 事件不被去噪抑制", () => {
      const event = makeEvent({
        type: PipelineEventType.SchedulerLoopCrashed,
        priority: PipelinePriority.CRITICAL,
        requestId: "l1-event-1",
      });

      const signal1 = filter.filter(event);
      expect(signal1).not.toBeNull();

      // L1 不应被抑制
      const event2 = makeEvent({
        type: PipelineEventType.SchedulerLoopCrashed,
        priority: PipelinePriority.CRITICAL,
        requestId: "l1-event-2",
      });
      const signal2 = filter.filter(event2);
      expect(signal2).not.toBeNull();
    });

    it("告警风暴检测——同类事件超过阈值 → 升级为 L1", () => {
      // 使用新 filter，降低风暴阈值为 5
      const stormFilter = new SentinelSignalFilter({
        deduplicationWindowMs: 5000,
        l3SampleRate: 1.0,
        alertStormThreshold: 5,
        l2EventTypes: [PipelineEventType.ErrorSilentUpgraded],
      });

      // 构造不同 requestId 但同聚合键的事件
      for (let i = 0; i < 4; i++) {
        const event = makeEvent({
          type: PipelineEventType.ErrorSilentUpgraded,
          priority: PipelinePriority.HIGH,
          requestId: `storm-${i}`,
          payload: { source: "test-source", consecutive: i },
        });
        stormFilter.filter(event);
      }

      // 第 5 次触发风暴告警
      const stormEvent = makeEvent({
        type: PipelineEventType.ErrorSilentUpgraded,
        priority: PipelinePriority.HIGH,
        requestId: "storm-4",
        payload: { source: "test-source", consecutive: 4 },
      });
      const signal = stormFilter.filter(stormEvent);
      expect(signal).not.toBeNull();
      expect(signal!.level).toBe("L1");
      expect(signal!.requiresImmediateAction).toBe(true);
    });
  });

  describe("createHandler() 管线处理器", () => {
    it("应创建可直接注册到 observer 的 handler", () => {
      const signals: FilteredSignal[] = [];
      const handler = filter.createHandler((signal) => signals.push(signal));

      expect(typeof handler).toBe("function");

      // 模拟事件发射
      const event = makeEvent({
        type: PipelineEventType.SchedulerLoopCrashed,
        priority: PipelinePriority.CRITICAL,
      });
      handler(event);

      expect(signals).toHaveLength(1);
      expect(signals[0].level).toBe("L1");
    });
  });

  describe("getStats() 统计信息", () => {
    it("返回缓存大小和热门聚合键", () => {
      // 触发几个事件建立缓存
      filter.filter(makeEvent({
        type: PipelineEventType.NodeComplete,
        priority: PipelinePriority.NORMAL,
      }));

      const stats = filter.getStats();
      expect(stats.cacheSize).toBeGreaterThan(0);
      expect(stats.topKeys).toBeInstanceOf(Array);
    });
  });

  describe("自定义 L1/L2 事件列表", () => {
    it("用户可自定义 L1 事件类型", () => {
      const customFilter = new SentinelSignalFilter({
        l1EventTypes: [PipelineEventType.NodeComplete], // 把 NodeComplete 设为 L1
        l3SampleRate: 1.0,
      });

      const event = makeEvent({
        type: PipelineEventType.NodeComplete,
        priority: PipelinePriority.NORMAL,
      });

      const signal = customFilter.filter(event);
      expect(signal!.level).toBe("L1");
    });
  });
});
