// @ci: unit
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PipelineEventType, PipelinePriority, type IPipelineObserver, type ObservableEvent, type PipelineHandler } from "@cortex/shared";
import { NotificationChannel } from "@cortex/notification";
import { NotificationRuntime } from "@cortex/engine";

/** Mock PipelineObserver——记录注册/注销的 handler */
function mockObserver(): IPipelineObserver & {
  handlers: Map<string, PipelineHandler[]>;
  emitToHandlers: (priority: PipelinePriority, event: ObservableEvent) => void;
} {
  const handlers = new Map<string, PipelineHandler[]>();

  const observer = {
    handlers,
    on: vi.fn((priority: PipelinePriority, handler: PipelineHandler) => {
      const key = String(priority);
      if (!handlers.has(key)) handlers.set(key, []);
      handlers.get(key)!.push(handler);
    }),
    off: vi.fn((priority: PipelinePriority, handler?: PipelineHandler) => {
      const key = String(priority);
      if (!handler) {
        handlers.delete(key);
      } else {
        const existing = handlers.get(key);
        if (existing) {
          handlers.set(key, existing.filter((h) => h !== handler));
        }
      }
    }),
    emit: vi.fn(),
    onHandlerError: vi.fn(),
    createSafeReporter: vi.fn(),
    emitToHandlers: (priority: PipelinePriority, event: ObservableEvent) => {
      const key = String(priority);
      const list = handlers.get(key);
      if (list) list.forEach((h) => h(event));
    },
  } as any;

  return observer;
}

/** Mock NotificationPipe——记录 push 的事件 */
function mockNotificationPipe(): { push: ReturnType<typeof vi.fn>; sent: ObservableEvent[] } {
  const sent: any[] = [];
  return {
    sent,
    push: vi.fn((event: any) => {
      sent.push(event);
    }),
  } as any;
}

describe("NotificationRuntime", () => {
  let observer: ReturnType<typeof mockObserver>;
  let pipe: ReturnType<typeof mockNotificationPipe>;
  let runtime: NotificationRuntime;

  beforeEach(() => {
    observer = mockObserver();
    pipe = mockNotificationPipe();
    runtime = new NotificationRuntime(observer, pipe as any);
  });

  describe("start() / stop() 生命周期", () => {
    it("start() 应订阅三个优先级（CRITICAL, HIGH, NORMAL）", () => {
      runtime.start();

      expect(observer.on).toHaveBeenCalledTimes(3);
      expect(observer.on).toHaveBeenCalledWith(PipelinePriority.CRITICAL, expect.any(Function));
      expect(observer.on).toHaveBeenCalledWith(PipelinePriority.HIGH, expect.any(Function));
      expect(observer.on).toHaveBeenCalledWith(PipelinePriority.NORMAL, expect.any(Function));
    });

    it("重复 start() 不应重复订阅", () => {
      runtime.start();
      runtime.start();

      expect(observer.on).toHaveBeenCalledTimes(3);
    });

    it("stop() 应注销所有 handler", () => {
      runtime.start();
      runtime.stop();

      expect(observer.off).toHaveBeenCalledTimes(3);
    });

    it("未 start 时 stop() 不报错", () => {
      expect(() => runtime.stop()).not.toThrow();
    });
  });

  describe("事件转发", () => {
    it("CRITICAL 事件应被转发到 NotificationPipe", () => {
      runtime.start();

      const event: ObservableEvent = {
        type: PipelineEventType.SchedulerLoopCrashed,
        priority: PipelinePriority.CRITICAL,
        payload: { round: 1, error: "crash!" },
        timestamp: Date.now(),
        requestId: "evt-1",
      };

      observer.emitToHandlers(PipelinePriority.CRITICAL, event);

      expect(pipe.push).toHaveBeenCalledTimes(1);
      expect(pipe.sent[0]).toMatchObject({
        type: PipelineEventType.SchedulerLoopCrashed,
      });
    });

    it("HIGH 事件应被转发", () => {
      runtime.start();

      const event: ObservableEvent = {
        type: PipelineEventType.ErrorReported,
        priority: PipelinePriority.HIGH,
        payload: { source: "test", severity: "degraded", error: "something failed" },
        timestamp: Date.now(),
        requestId: "evt-2",
      };

      observer.emitToHandlers(PipelinePriority.HIGH, event);

      expect(pipe.push).toHaveBeenCalledTimes(1);
    });

    it("NORMAL 事件应被转发", () => {
      runtime.start();

      const event: ObservableEvent = {
        type: PipelineEventType.NodeComplete,
        priority: PipelinePriority.NORMAL,
        payload: { nodeId: "n1", agentType: "code", success: true },
        timestamp: Date.now(),
        requestId: "evt-3",
      };

      observer.emitToHandlers(PipelinePriority.NORMAL, event);

      expect(pipe.push).toHaveBeenCalledTimes(1);
    });
  });

  describe("语义映射", () => {
    it("SchedulerLoopCrashed → DECISION_REQUIRED", () => {
      runtime.start();

      const event: ObservableEvent = {
        type: PipelineEventType.SchedulerLoopCrashed,
        priority: PipelinePriority.CRITICAL,
        payload: { round: 1, error: "crash" },
        timestamp: Date.now(),
        requestId: "evt-decision",
      };

      observer.emitToHandlers(PipelinePriority.CRITICAL, event);

      const sent = pipe.sent[0] as any;
      expect(sent.semantics).toBe("DECISION_REQUIRED");
      expect(sent.ackRequired).toBe(true);
      expect(sent.channel).toBe("urgent");
    });

    it("ErrorReported → WARNING", () => {
      runtime.start();

      const event: ObservableEvent = {
        type: PipelineEventType.ErrorReported,
        priority: PipelinePriority.HIGH,
        payload: { source: "test", severity: "degraded", error: "fail" },
        timestamp: Date.now(),
        requestId: "evt-warning",
      };

      observer.emitToHandlers(PipelinePriority.HIGH, event);

      const sent = pipe.sent[0] as any;
      expect(sent.semantics).toBe("WARNING");
      expect(sent.channel).toBe("important");
    });

    it("NodeComplete → FYI", () => {
      runtime.start();

      const event: ObservableEvent = {
        type: PipelineEventType.NodeComplete,
        priority: PipelinePriority.NORMAL,
        payload: { nodeId: "n1", agentType: "code", success: true },
        timestamp: Date.now(),
        requestId: "evt-fyi",
      };

      observer.emitToHandlers(PipelinePriority.NORMAL, event);

      const sent = pipe.sent[0] as any;
      expect(sent.semantics).toBe("FYI");
      expect(sent.channel).toBe("routine");
    });
  });

  describe("自定义语义映射", () => {
    it("用户可覆写默认语义", () => {
      const customRuntime = new NotificationRuntime(observer, pipe as any, {
        eventSemantics: {
          [PipelineEventType.NodeComplete]: "WARNING",
        },
      });
      customRuntime.start();

      const event: ObservableEvent = {
        type: PipelineEventType.NodeComplete,
        priority: PipelinePriority.NORMAL,
        payload: { nodeId: "n1", agentType: "code", success: true },
        timestamp: Date.now(),
        requestId: "evt-custom",
      };

      observer.emitToHandlers(PipelinePriority.NORMAL, event);

      const sent = pipe.sent[0] as any;
      expect(sent.semantics).toBe("WARNING");
    });
  });

  describe("容错处理", () => {
    it("NotificationPipe.push 抛异常 → 不崩溃", () => {
      pipe.push.mockImplementation(() => {
        throw new Error("pipe crashed");
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});

      runtime.start();

      const event: ObservableEvent = {
        type: PipelineEventType.NodeComplete,
        priority: PipelinePriority.NORMAL,
        payload: { nodeId: "n1", agentType: "code", success: true },
        timestamp: Date.now(),
        requestId: "evt-err",
      };

      expect(() => {
        observer.emitToHandlers(PipelinePriority.NORMAL, event);
      }).not.toThrow();
    });

    it("无 payload 的事件 → 跳过不转发", () => {
      runtime.start();

      const event: ObservableEvent = {
        type: PipelineEventType.NodeComplete,
        priority: PipelinePriority.NORMAL,
        payload: undefined as any,
        timestamp: Date.now(),
        requestId: "evt-no-payload",
      };

      observer.emitToHandlers(PipelinePriority.NORMAL, event);

      expect(pipe.push).not.toHaveBeenCalled();
    });
  });

  describe("S2-4: MemoryPersistFailed 事件闭环", () => {
    it("记忆持久化失败 → 转通知且语义为 WARNING（Important 通道）", () => {
      runtime.start();

      const event: ObservableEvent = {
        type: PipelineEventType.MemoryPersistFailed,
        priority: PipelinePriority.HIGH,
        payload: { operation: "persist", error: "disk full" },
        timestamp: Date.now(),
        requestId: "evt-persist-fail",
      };

      observer.emitToHandlers(PipelinePriority.HIGH, event);

      expect(pipe.push).toHaveBeenCalledTimes(1);
      expect(pipe.sent[0]).toMatchObject({
        type: PipelineEventType.MemoryPersistFailed,
        channel: NotificationChannel.Important,
        ackRequired: false,
        semantics: "WARNING",
        summary: "错误: disk full",
      });
    });
  });

  // ══════════════════════════════════════════════════════════
  // R13-D2 —— 归并键回归
  //
  // 缺陷：_eventToNotification 从不设置 mergeKey → NotificationPipe 的归并分支
  // 永不进入，而 setMergeRules 当时也是零调用。整套归并子系统在上线路径上是死代码，
  // 2026-08-03/04 一次调度崩溃循环把 963 万条 error.reported / node.failed 逐条落盘。
  // ══════════════════════════════════════════════════════════
  describe("R13-D2: 归并键", () => {
    /** 发一条事件并取回被 push 的通知 */
    function emit(type: PipelineEventType, payload: Record<string, unknown>) {
      const event: ObservableEvent = {
        type,
        priority: PipelinePriority.HIGH,
        payload,
        timestamp: Date.now(),
        requestId: `evt-${Math.random().toString(36).slice(2, 9)}`,
      };
      observer.emitToHandlers(PipelinePriority.HIGH, event);
      return pipe.sent[pipe.sent.length - 1] as any;
    }

    it("ErrorReported 携带归并键", () => {
      runtime.start();
      const sent = emit(PipelineEventType.ErrorReported, {
        source: "scheduler",
        severity: "warn",
        error: "dispatch failed",
      });
      expect(sent.mergeKey).toBeTruthy();
    });

    it("同源同类错误 → 归并键相同（行号/计数/请求 id 全部抹平）", () => {
      runtime.start();
      // 崩溃循环里同一条错误的差异只在数字与 uuid——指纹抹的就是这些。
      // 注意指纹是「形状归一化」而不是语义分类：换了措辞就算另一个键（见下一条用例）。
      const a = emit(PipelineEventType.ErrorReported, {
        source: "scheduler",
        severity: "warn",
        error: "node 4821 failed at line 137",
      });
      const b = emit(PipelineEventType.ErrorReported, {
        source: "scheduler",
        severity: "warn",
        error: "node 9134 failed at line 90284",
      });
      expect(b.mergeKey).toBe(a.mergeKey);
    });

    it("同形状但 uuid 不同 → 归并键相同（uuid 被抹平）", () => {
      runtime.start();
      const a = emit(PipelineEventType.ErrorReported, {
        source: "scheduler",
        severity: "warn",
        error: "req 550e8400-e29b-41d4-a716-446655440000 failed",
      });
      const b = emit(PipelineEventType.ErrorReported, {
        source: "scheduler",
        severity: "warn",
        error: "req 6ba7b810-9dad-11d1-80b4-00c04fd430c8 failed",
      });
      expect(b.mergeKey).toBe(a.mergeKey);
    });

    it("不同源 → 归并键不同（不把两处故障揉成一条）", () => {
      runtime.start();
      const a = emit(PipelineEventType.ErrorReported, {
        source: "scheduler",
        severity: "warn",
        error: "same text",
      });
      const b = emit(PipelineEventType.ErrorReported, {
        source: "memory-store",
        severity: "warn",
        error: "same text",
      });
      expect(b.mergeKey).not.toBe(a.mergeKey);
    });

    it("不同类错误 → 归并键不同（不丢信息）", () => {
      runtime.start();
      const a = emit(PipelineEventType.ErrorReported, {
        source: "scheduler",
        severity: "warn",
        error: "disk full",
      });
      const b = emit(PipelineEventType.ErrorReported, {
        source: "scheduler",
        severity: "warn",
        error: "connection refused",
      });
      expect(b.mergeKey).not.toBe(a.mergeKey);
    });

    it("NodeFailed 按 nodeId 归并", () => {
      runtime.start();
      const a = emit(PipelineEventType.NodeFailed, { nodeId: "n-1", error: "boom" });
      const b = emit(PipelineEventType.NodeFailed, { nodeId: "n-1", error: "boom" });
      const c = emit(PipelineEventType.NodeFailed, { nodeId: "n-2", error: "boom" });
      expect(a.mergeKey).toBeTruthy();
      expect(b.mergeKey).toBe(a.mergeKey);
      expect(c.mergeKey).not.toBe(a.mergeKey);
    });

    it("FYI 类事件不做归并", () => {
      runtime.start();
      const sent = emit(PipelineEventType.NodeComplete, {
        nodeId: "n1",
        agentType: "code",
        success: true,
      });
      expect(sent.mergeKey).toBeUndefined();
    });

    it("决策类事件永不归并——每一条都必须单独可见", () => {
      runtime.start();
      const sent = emit(PipelineEventType.SchedulerLoopCrashed, { round: 1, error: "crash" });
      expect(sent.mergeKey).toBeUndefined();
      expect(sent.ackRequired).toBe(true);
    });
  });
});
