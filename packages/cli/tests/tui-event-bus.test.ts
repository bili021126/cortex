/**
 * TUI 核心测试：event-bus（事件总线——订阅/发布/退订/通配符）
 */
import { describe, it, expect, beforeEach } from "vitest";
import { TuiEventBus } from "../src/tui/event-bus.js";

let bus: TuiEventBus;

beforeEach(() => {
  bus = new TuiEventBus();
});

describe("TuiEventBus", () => {
  it("订阅后能收到事件", () => {
    const received: string[] = [];
    bus.on("chat.message", (e) => received.push(e.type));
    bus.emit({ type: "chat.message", payload: {} } as never);
    expect(received).toContain("chat.message");
  });

  it("通配符 * 订阅所有事件", () => {
    const received: string[] = [];
    bus.on("*", (e) => received.push(e.type));
    bus.emit({ type: "task.created", payload: {} } as never);
    bus.emit({ type: "agent.wakeup", payload: {} } as never);
    expect(received).toEqual(["task.created", "agent.wakeup"]);
  });

  it("退订后不再收到", () => {
    let count = 0;
    const off = bus.on("task.created", () => { count += 1; });
    bus.emit({ type: "task.created", payload: {} } as never);
    off();
    bus.emit({ type: "task.created", payload: {} } as never);
    expect(count).toBe(1);
  });

  it("同类型多个订阅者都收到", () => {
    let a = 0;
    let b = 0;
    bus.on("agent.wakeup", () => { a += 1; });
    bus.on("agent.wakeup", () => { b += 1; });
    bus.emit({ type: "agent.wakeup", payload: {} } as never);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it("未订阅的类型不报错", () => {
    expect(() => bus.emit({ type: "nonexistent.type", payload: {} } as never)).not.toThrow();
  });

  it("on 返回退订函数——重复调用安全", () => {
    const off = bus.on("task.created", () => {});
    off();
    expect(() => off()).not.toThrow();
  });
});
