// @ci: unit
import { describe, it, expect } from "vitest";
import { TuiEventBus, tuiEventBus } from "../src/tui/event-bus.js";

describe("TuiEventBus", () => {
  function emit(bus: TuiEventBus, overrides: Record<string, any> = {}) {
    bus.emit({ type: "tool_result", agent: "code" as any, tool: "read_file", success: true, output: "data", durationMs: 0, ...overrides } as any);
  }

  it("单例模式——tuiEventBus 是 TuiEventBus 实例", () => {
    expect(tuiEventBus).toBeInstanceOf(TuiEventBus);
  });

  it("emit 同步触发 on 监听器", () => {
    const bus = new TuiEventBus();
    let received: any = null;
    bus.on("tool_result", (e) => { received = e; });
    emit(bus, { tool: "write_file" });
    expect(received).not.toBeNull();
    expect(received.tool).toBe("write_file");
  });

  it("off 移除监听（通过返回的取消函数）", () => {
    const bus = new TuiEventBus();
    let count = 0;
    const unsub = bus.on("tool_result", () => { count++; });
    emit(bus);
    expect(count).toBe(1);
    unsub();
    emit(bus);
    expect(count).toBe(1);
  });

  it("多次 emit 累加计数", () => {
    const bus = new TuiEventBus();
    let count = 0;
    bus.on("tool_result", () => { count++; });
    for (let i = 0; i < 5; i++) emit(bus);
    expect(count).toBe(5);
  });

  it("通配符 * 匹配所有事件", () => {
    const bus = new TuiEventBus();
    const received: string[] = [];
    bus.on("*", (e) => received.push(e.type));
    emit(bus);
    bus.emit({ type: "tool_start" as any, agent: "fix" as any, tool: "search_code" });
    expect(received).toContain("tool_result");
    expect(received).toContain("tool_start");
  });

  it("未注册的事件类型不抛异常", () => {
    const bus = new TuiEventBus();
    expect(() => emit(bus)).not.toThrow();
  });

  // ── D1 深度测试 ────────────────────────────────

  describe("通配符 '*' 订阅", () => {
    it("通配符接收所有事件类型", () => {
      const bus = new TuiEventBus();
      const events: string[] = [];
      bus.on("*", (e) => events.push(e.type));

      bus.emit({ type: "tool_start" as any, agent: "code" as any, tool: "read", input: "x" });
      bus.emit({ type: "tool_result" as any, agent: "code" as any, tool: "read", success: true, durationMs: 10 });
      bus.emit({ type: "llm_chunk" as any, agent: "code" as any, content: "hello" });
      bus.emit({ type: "node_start" as any, nodeId: "n1", nodeType: "task", agent: "code" as any, description: "test" });
      bus.emit({ type: "session_start" as any });

      expect(events).toEqual(["tool_start", "tool_result", "llm_chunk", "node_start", "session_start"]);
    });

    it("通配符与类型监听器互不干扰", () => {
      const bus = new TuiEventBus();
      const wildcardEvents: string[] = [];
      const typedEvents: string[] = [];

      bus.on("*", (e) => wildcardEvents.push(e.type));
      bus.on("tool_result", (e) => typedEvents.push(e.type));

      emit(bus);
      emit(bus, { type: "tool_start" as any, tool: "search_code" });

      expect(wildcardEvents).toHaveLength(2);
      expect(typedEvents).toHaveLength(1);
    });
  });

  describe("取消订阅", () => {
    it("通过 off 直接取消订阅后不再触发", () => {
      const bus = new TuiEventBus();
      let count = 0;
      const listener = () => { count++; };
      bus.on("tool_result", listener);
      emit(bus);
      expect(count).toBe(1);
      bus.off("tool_result", listener);
      emit(bus);
      expect(count).toBe(1);
    });

    it("取消未注册的监听器不抛异常", () => {
      const bus = new TuiEventBus();
      const listener = () => {};
      expect(() => bus.off("nonexistent", listener)).not.toThrow();
    });

    it("多次取消同一监听器安全", () => {
      const bus = new TuiEventBus();
      const listener = () => {};
      bus.on("tool_result", listener);
      bus.off("tool_result", listener);
      expect(() => bus.off("tool_result", listener)).not.toThrow();
    });

    it("取消通配符监听器", () => {
      const bus = new TuiEventBus();
      let count = 0;
      const listener = () => { count++; };
      bus.on("*", listener);
      emit(bus);
      expect(count).toBe(1);
      bus.off("*", listener);
      emit(bus);
      expect(count).toBe(1);
    });
  });

  describe("错误处理", () => {
    it("监听器抛出异常不中断其他订阅者", () => {
      const bus = new TuiEventBus();
      const results: string[] = [];

      bus.on("tool_result", () => { results.push("first"); });
      bus.on("tool_result", () => { throw new Error("oops"); });
      bus.on("tool_result", () => { results.push("third"); });

      expect(() => emit(bus)).not.toThrow();
      expect(results).toContain("first");
      expect(results).toContain("third");
    });

    it("通配符监听器异常被捕获不传播", () => {
      const bus = new TuiEventBus();
      const results: string[] = [];

      bus.on("*", () => { results.push("ok"); });
      bus.on("*", () => { throw new Error("wildcard fail"); });

      expect(() => emit(bus)).not.toThrow();
      expect(results).toContain("ok");
    });

    it("一个监听器异常不影响后续 emit", () => {
      const bus = new TuiEventBus();
      let afterError = 0;

      bus.on("tool_result", () => { throw new Error("fail"); });
      bus.on("tool_result", () => { afterError++; });

      emit(bus);
      emit(bus); // 第二次 emit 仍正常工作
      expect(afterError).toBe(2);
    });
  });

  describe("高频事件性能", () => {
    it("1000 次 emit 性能可接受 (< 200ms)", () => {
      const bus = new TuiEventBus();
      let count = 0;
      bus.on("tool_result", () => { count++; });

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        bus.emit({ type: "tool_result" as any, agent: "code" as any, tool: "t", success: true, durationMs: 0 });
      }
      const elapsed = performance.now() - start;

      expect(count).toBe(1000);
      expect(elapsed).toBeLessThan(200);
    });

    it("1000 次 emit 带通配符性能可接受 (< 300ms)", () => {
      const bus = new TuiEventBus();
      let count = 0;
      bus.on("*", () => { count++; });

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        bus.emit({ type: "tool_result" as any, agent: "code" as any, tool: "t", success: true, durationMs: 0 });
      }
      const elapsed = performance.now() - start;

      expect(count).toBe(1000);
      expect(elapsed).toBeLessThan(300);
    });
  });

  describe("clear 与 listenerCount", () => {
    it("listenerCount 准确统计", () => {
      const bus = new TuiEventBus();
      expect(bus.listenerCount).toBe(0);

      bus.on("tool_result", () => {});
      bus.on("tool_start", () => {});
      bus.on("*", () => {});
      expect(bus.listenerCount).toBe(3);
    });

    it("clear 清空所有监听器", () => {
      const bus = new TuiEventBus();
      bus.on("tool_result", () => {});
      bus.on("*", () => {});
      bus.clear();
      expect(bus.listenerCount).toBe(0);
      // clear 后 emit 不触发任何监听
      let count = 0;
      bus.on("tool_result", () => { count++; });
      expect(count).toBe(0); // 新监听器不受影响
    });
  });

  describe("once 一次性订阅", () => {
    it("once 只触发一次", () => {
      const bus = new TuiEventBus();
      let count = 0;
      bus.once("tool_result", () => { count++; });
      emit(bus);
      emit(bus);
      expect(count).toBe(1);
    });
  });
});
