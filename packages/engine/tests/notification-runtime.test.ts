// @ci: unit
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PipelineEventType, PipelinePriority, type IPipelineObserver, type ObservableEvent, type PipelineHandler } from "@cortex/shared";
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
});
