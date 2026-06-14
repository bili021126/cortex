// @ci: unit
// ============================================================
// console-bridge.test.ts — ConsoleBridge 单元测试
//
// 覆盖：install 拦截 console、uninstall 恢复、
//       白名单豁免、error → ErrorReported 转换
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installConsoleBridge, uninstallConsoleBridge } from "@cortex/engine";
import { PipelineEventType, PipelinePriority, type IPipelineObserver, type ObservableEvent } from "@cortex/shared";

// ── Mock observer ──────────────────────────────

function makeMockObserver(): IPipelineObserver & { events: ObservableEvent[] } {
  return {
    events: [],
    emit(event: ObservableEvent): void {
      this.events.push(event);
    },
    on(): void { /* noop */ },
    off(): void { /* noop */ },
  };
}

// ── Tests ──────────────────────────────────────

describe("ConsoleBridge", () => {
  let observer: ReturnType<typeof makeMockObserver>;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;
  let originalLog: typeof console.log;

  beforeEach(() => {
    observer = makeMockObserver();
    // 保存原始 console 方法
    originalWarn = console.warn;
    originalError = console.error;
    originalLog = console.log;
  });

  afterEach(() => {
    // 确保恢复
    uninstallConsoleBridge();
    console.warn = originalWarn;
    console.error = originalError;
    console.log = originalLog;
  });

  // ── install / uninstall ──────────────────────

  it("install 后 console.error 被拦截——转为 ErrorReported 事件", () => {
    installConsoleBridge(observer);

    console.error("test error message");

    expect(observer.events.length).toBeGreaterThanOrEqual(1);
    const event = observer.events[0];
    expect(event.type).toBe(PipelineEventType.ErrorReported);
    expect(event.priority).toBe(PipelinePriority.HIGH);
    expect(event.payload).toMatchObject({
      source: "console_bridge",
      severity: "error",
      error: "test error message",
    });
  });

  it("install 后 console.warn 被拦截——转为 ErrorReported（NORMAL 优先级）", () => {
    installConsoleBridge(observer);

    console.warn("something suspicious");

    expect(observer.events.length).toBe(1);
    const event = observer.events[0];
    expect(event.type).toBe(PipelineEventType.ErrorReported);
    expect(event.priority).toBe(PipelinePriority.NORMAL);
    expect(event.payload).toMatchObject({
      source: "console_bridge",
      severity: "warn",
      error: "something suspicious",
    });
  });

  it("install 后 console.log 被静默（不 emit 事件）", () => {
    installConsoleBridge(observer);

    const eventCount = observer.events.length;
    console.log("this should be silenced");

    expect(observer.events.length).toBe(eventCount);
  });

  it("uninstall 恢复原始 console 方法", () => {
    installConsoleBridge(observer);
    uninstallConsoleBridge();

    // 恢复后调用不应产生事件
    const eventCount = observer.events.length;
    console.error("after uninstall");
    expect(observer.events.length).toBe(eventCount);
  });

  it("重复 install 只生效一次", () => {
    installConsoleBridge(observer);
    installConsoleBridge(observer);

    console.error("only one event expected");

    // 应该只产生一个事件（不是两个）
    expect(observer.events.length).toBe(1);
  });

  it("重复 uninstall 安全", () => {
    installConsoleBridge(observer);
    uninstallConsoleBridge();
    expect(() => uninstallConsoleBridge()).not.toThrow();
  });

  // ── 白名单 ───────────────────────────────────

  it("MemoryStoreMonitor 的消息走白名单——不被拦截", () => {
    installConsoleBridge(observer);

    // MemoryStoreMonitor 格式的消息应直接通过，不转为事件
    const eventCount = observer.events.length;
    console.error("[MemoryStoreMonitor] ALERT: something");

    expect(observer.events.length).toBe(eventCount);
  });

  // ── Error 对象 ───────────────────────────────

  it("Error 对象作为参数时提取 message", () => {
    installConsoleBridge(observer);

    console.error(new Error("something broke"));

    expect(observer.events.length).toBeGreaterThanOrEqual(1);
    expect(observer.events[0].payload).toMatchObject({
      source: "console_bridge",
      severity: "error",
      error: "something broke",
    });
  });

  // ── 多参数 ───────────────────────────────────

  it("多参数拼接为一条消息", () => {
    installConsoleBridge(observer);

    console.error("error:", "detail", 42);

    expect(observer.events.length).toBeGreaterThanOrEqual(1);
    const payload = observer.events[0].payload as Record<string, unknown>;
    expect(String(payload.error)).toContain("error:");
    expect(String(payload.error)).toContain("detail");
    expect(String(payload.error)).toContain("42");
  });

  // ── 未安装时不拦截 ──────────────────────────

  it("未安装时 console 按原始行为工作", () => {
    // 确保未安装
    uninstallConsoleBridge();

    const eventCount = observer.events.length;
    console.error("should not be routed to observer");
    expect(observer.events.length).toBe(eventCount);
  });
});
