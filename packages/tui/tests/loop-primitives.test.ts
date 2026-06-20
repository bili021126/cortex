import { describe, it, expect, vi } from "vitest";

// Mock minimal bridge for testing
function createMockBridge() {
  const handlers = new Map<string, Array<(data: any) => void>>();
  return {
    on: vi.fn((e: string, fn: any) => {
      if (!handlers.has(e)) handlers.set(e, []);
      handlers.get(e)!.push(fn);
    }),
    emit: vi.fn((e: string, d: any) => handlers.get(e)?.forEach(fn => fn(d))),
    send: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };
}

describe("Tui loop primitives", () => {
  it("mock bridge emit → on 同步", () => {
    const bridge = createMockBridge();
    let msg = "";
    bridge.on("message", (d: any) => { msg = d.text; });
    bridge.emit("message", { text: "hello" });
    expect(msg).toBe("hello");
  });

  it("mock bridge 多次触发", () => {
    const bridge = createMockBridge();
    const received: string[] = [];
    bridge.on("data", (d: any) => received.push(d));
    bridge.emit("data", "a");
    bridge.emit("data", "b");
    bridge.emit("data", "c");
    expect(received).toEqual(["a", "b", "c"]);
  });

  it("mock bridge on 可被多次调用（多 handler）", () => {
    const bridge = createMockBridge();
    const a: number[] = [], b: number[] = [];
    bridge.on("num", (n: number) => a.push(n));
    bridge.on("num", (n: number) => b.push(n * 2));
    bridge.emit("num", 3);
    expect(a).toEqual([3]);
    expect(b).toEqual([6]);
  });
});
