import { describe, it, expect } from "vitest";
import { TuiEventBus, tuiEventBus } from "../src/event-bus.js";

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
});
