// @ci: unit
// ============================================================
// monitor.test.ts — MemoryStoreMonitor 单元测试
//
// 覆盖：start/stop 监听注册、事件过滤、阈值告警、关键事件落盘
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryStoreMonitor } from "@cortex/memory-store";
import { PipelineEventType, PipelinePriority } from "@cortex/shared";
// ── Mock IPipelineObserver ─────────────────────
function makeMockObserver() {
    const handlers = new Map();
    const emitted = [];
    return {
        emitted,
        handlers,
        emit(event) {
            emitted.push(event);
            const hs = handlers.get(event.priority) ?? [];
            for (const h of hs) {
                try {
                    h(event);
                }
                catch { /* noop */ }
            }
        },
        on(priority, handler) {
            const hs = handlers.get(priority) ?? [];
            hs.push(handler);
            handlers.set(priority, hs);
        },
        off(priority, handler) {
            if (!handler) {
                handlers.delete(priority);
                return;
            }
            const hs = handlers.get(priority);
            if (hs) {
                const filtered = hs.filter((h) => h !== handler);
                if (filtered.length === 0) {
                    handlers.delete(priority);
                }
                else {
                    handlers.set(priority, filtered);
                }
            }
        },
    };
}
function makeMemoryEvent(overrides = {}) {
    return {
        type: PipelineEventType.MemoryPersistFailed,
        priority: PipelinePriority.CRITICAL,
        payload: { operation: "save", error: "test error" },
        timestamp: Date.now(),
        ...overrides,
    };
}
// ── Tests ──────────────────────────────────────
describe("MemoryStoreMonitor", () => {
    let observer;
    beforeEach(() => {
        observer = makeMockObserver();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });
    // ── start / stop ────────────────────────────
    it("start 注册 CRITICAL/HIGH/NORMAL 三个优先级的 handler", () => {
        const monitor = new MemoryStoreMonitor(observer);
        monitor.start();
        // 三个优先级都应注册了 handler
        expect(observer.handlers.has(PipelinePriority.CRITICAL)).toBe(true);
        expect(observer.handlers.has(PipelinePriority.HIGH)).toBe(true);
        expect(observer.handlers.has(PipelinePriority.NORMAL)).toBe(true);
    });
    it("stop 移除所有注册的 handler", () => {
        const monitor = new MemoryStoreMonitor(observer);
        monitor.start();
        expect(observer.handlers.size).toBe(3);
        monitor.stop();
        // stop 后所有 handler 被移除
        expect(observer.handlers.size).toBe(0);
    });
    // ── 事件过滤 ────────────────────────────────
    it("只处理 memory.* 事件", () => {
        const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const monitor = new MemoryStoreMonitor(observer, { logToStdout: false });
        monitor.start();
        // 非 memory 事件不应落盘
        observer.emit({
            type: PipelineEventType.NodeStart,
            priority: PipelinePriority.NORMAL,
            payload: { nodeId: "n1", type: "code" },
            timestamp: Date.now(),
        });
        // memory 事件应落盘（CRITICAL 类型）
        observer.emit(makeMemoryEvent());
        monitor.stop();
        // 验证只有 memory 事件落盘（一次 write 调用）
        const writes = spy.mock.calls.filter((c) => String(c[0]).includes("ARCHIVE"));
        expect(writes.length).toBe(1);
        spy.mockRestore();
    });
    // ── 阈值告警 ────────────────────────────────
    it("超过阈值触发告警", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { });
        const monitor = new MemoryStoreMonitor(observer, {
            threshold: 2,
            windowMs: 60_000,
            logToStdout: false,
        });
        monitor.start();
        // 发送 3 个 memory 事件（超过阈值 2）
        for (let i = 0; i < 3; i++) {
            observer.emit(makeMemoryEvent());
        }
        monitor.stop();
        // 应触发告警
        const alertCalls = errorSpy.mock.calls.filter((c) => String(c[0]).includes("ALERT"));
        expect(alertCalls.length).toBeGreaterThanOrEqual(1);
        errorSpy.mockRestore();
    });
    it("阈值以下不触发告警", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { });
        const monitor = new MemoryStoreMonitor(observer, {
            threshold: 5,
            windowMs: 60_000,
            logToStdout: false,
        });
        monitor.start();
        // 发送 2 个事件（低于阈值 5）
        observer.emit(makeMemoryEvent());
        observer.emit(makeMemoryEvent());
        monitor.stop();
        const alertCalls = errorSpy.mock.calls.filter((c) => String(c[0]).includes("ALERT"));
        expect(alertCalls.length).toBe(0);
        errorSpy.mockRestore();
    });
    it("告警防抖：同一窗口只触发一次告警", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { });
        const monitor = new MemoryStoreMonitor(observer, {
            threshold: 1,
            windowMs: 60_000,
            logToStdout: false,
        });
        monitor.start();
        // 连续发送多个事件
        for (let i = 0; i < 5; i++) {
            observer.emit(makeMemoryEvent());
        }
        monitor.stop();
        // 只应触发一次告警（_alerted 标记防抖）
        const alertCalls = errorSpy.mock.calls.filter((c) => String(c[0]).includes("ALERT"));
        expect(alertCalls.length).toBe(1);
        errorSpy.mockRestore();
    });
    // ── 关键事件落盘 ────────────────────────────
    it("persist_failed 事件落盘归档", () => {
        const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const monitor = new MemoryStoreMonitor(observer);
        monitor.start();
        observer.emit(makeMemoryEvent({
            type: PipelineEventType.MemoryPersistFailed,
            priority: PipelinePriority.CRITICAL,
            payload: { operation: "save", error: "disk full" },
        }));
        monitor.stop();
        const archiveCalls = stderrSpy.mock.calls.filter((c) => String(c[0]).includes("ARCHIVE"));
        expect(archiveCalls.length).toBe(1);
        expect(String(archiveCalls[0][0])).toContain("disk full");
        stderrSpy.mockRestore();
    });
    it("sql_degraded 事件落盘归档", () => {
        const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const monitor = new MemoryStoreMonitor(observer);
        monitor.start();
        observer.emit(makeMemoryEvent({
            type: PipelineEventType.MemorySqlDegraded,
            priority: PipelinePriority.HIGH,
            payload: { operation: "query", detail: "slow query > 5s" },
        }));
        monitor.stop();
        const archiveCalls = stderrSpy.mock.calls.filter((c) => String(c[0]).includes("ARCHIVE"));
        expect(archiveCalls.length).toBe(1);
        stderrSpy.mockRestore();
    });
    it("deserialize_failed 事件落盘归档", () => {
        const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const monitor = new MemoryStoreMonitor(observer);
        monitor.start();
        observer.emit(makeMemoryEvent({
            type: PipelineEventType.MemoryDeserializeFailed,
            priority: PipelinePriority.HIGH,
            payload: { rowId: "r123", error: "corrupt data" },
        }));
        monitor.stop();
        const archiveCalls = stderrSpy.mock.calls.filter((c) => String(c[0]).includes("ARCHIVE"));
        expect(archiveCalls.length).toBe(1);
        stderrSpy.mockRestore();
    });
    // ── 非关键事件不落盘 ────────────────────────
    it("MemoryWriteBlocked（非关键类型）不落盘", () => {
        const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const monitor = new MemoryStoreMonitor(observer);
        monitor.start();
        observer.emit(makeMemoryEvent({
            type: PipelineEventType.MemoryWriteBlocked,
            priority: PipelinePriority.HIGH,
            payload: { reason: "store not initialized" },
        }));
        monitor.stop();
        // MemoryWriteBlocked 不是关键类型，不应落盘
        const archiveCalls = stderrSpy.mock.calls.filter((c) => String(c[0]).includes("ARCHIVE"));
        expect(archiveCalls.length).toBe(0);
        stderrSpy.mockRestore();
    });
    // ── 选项 ────────────────────────────────────
    it("构造函数使用默认 windowMs=60000, threshold=10", () => {
        const monitor = new MemoryStoreMonitor(observer);
        // 不抛错即可——内部使用默认值
        monitor.start();
        monitor.stop();
    });
});
//# sourceMappingURL=monitor.test.js.map