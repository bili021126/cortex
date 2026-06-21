// @ci: unit
/**
 * 测试文件: ShutdownWarden 优雅关闭监护
 *
 * @since v3.1.0
 *
 * 测试范围:
 * - shutdown() 完整序列 (LifecycleManager → endSession → close)
 * - 组件失败时的容错
 * - ShutdownReport 字段验证
 * - 无 memory 场景
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ShutdownWarden } from "@cortex/engine";
import { LifecycleManager } from "@cortex/engine";
import { LifecyclePhase } from "@cortex/shared";
/** 轻量 Lifecycle mock — 仅用于测试 ShutdownWarden 编排 */
class MockLifecycle {
    phase = LifecyclePhase.Created;
    _initFn = async () => { };
    _stopFn = async () => { };
    init = async () => { await this._initFn(); this.phase = LifecyclePhase.Running; };
    start = async () => { this.phase = LifecyclePhase.Running; };
    stop = async () => { await this._stopFn(); this.phase = LifecyclePhase.Stopped; };
    dispose = () => { this.phase = LifecyclePhase.Disposed; };
    setInit(fn) { this._initFn = fn; }
    setStop(fn) { this._stopFn = fn; }
}
/** 轻量 IMemoryStore mock */
function mockMemory() {
    let closed = false;
    return {
        isPersisted: false,
        size: 0,
        sessionId: undefined,
        init: async () => { },
        beginSession: () => "s1",
        endSession: async () => 0,
        write: async () => "",
        read: async () => [],
        link: () => null,
        getLinks: () => [],
        has: () => false,
        cas: () => false,
        archive: () => false,
        obliterate: () => false,
        writePending: () => "",
        commitMemory: () => false,
        rollback: () => false,
        getPending: () => [],
        hasPending: () => false,
        getBySession: () => [],
        peek: () => undefined,
        flush: async () => { },
        maintain: () => ({ archived: 0, obliterated: 0, orphanedLinks: 0, staleArchiveCount: 0, weightAdjustments: 0 }),
        setPreWriteHook: () => { },
        close: async () => { closed = true; },
    };
}
describe("ShutdownWarden", () => {
    let lm;
    let mock;
    beforeEach(() => {
        lm = new LifecycleManager();
        mock = new MockLifecycle();
    });
    it("完整 shutdown 序列——lifecycleManager + memory 均成功", async () => {
        lm.register("testComp", mock);
        await lm.bootstrap();
        const memory = mockMemory();
        const endSessionSpy = vi.spyOn(memory, "endSession");
        const closeSpy = vi.spyOn(memory, "close");
        const warden = new ShutdownWarden(lm, memory, undefined, 5000, 0);
        const report = await warden.shutdown();
        expect(endSessionSpy).toHaveBeenCalledTimes(1);
        expect(closeSpy).toHaveBeenCalledTimes(1);
        expect(report.endSessionDone).toBe(true);
        expect(report.failedComponents).toHaveLength(0);
        expect(report.stopDurationMs).toBeGreaterThanOrEqual(0);
    });
    it("无 memory 时仅做 lifecycle shutdown", async () => {
        lm.register("testComp", mock);
        await lm.bootstrap();
        const warden = new ShutdownWarden(lm, undefined);
        const report = await warden.shutdown();
        expect(report.endSessionDone).toBe(false);
        expect(report.failedComponents).toHaveLength(0);
    });
    it("endSession 失败 → failedComponents 记录", async () => {
        lm.register("testComp", mock);
        await lm.bootstrap();
        const memory = mockMemory();
        vi.spyOn(memory, "endSession").mockRejectedValue(new Error("END_FAIL"));
        const warden = new ShutdownWarden(lm, memory, undefined, 5000, 100);
        const report = await warden.shutdown();
        expect(report.endSessionDone).toBe(false);
        expect(report.failedComponents).toContain("memoryStore.endSession");
        // 有失败组件时 forceExitDelayMs > 0
        expect(report.forceExitDelayMs).toBe(100);
    });
    it("close 失败 → failedComponents 记录（但 endSession 仍成功）", async () => {
        lm.register("testComp", mock);
        await lm.bootstrap();
        const memory = mockMemory();
        vi.spyOn(memory, "close").mockRejectedValue(new Error("CLOSE_FAIL"));
        const warden = new ShutdownWarden(lm, memory, undefined, 5000, 100);
        const report = await warden.shutdown();
        expect(report.endSessionDone).toBe(true);
        expect(report.failedComponents).toContain("memoryStore.close");
        expect(report.forceExitDelayMs).toBe(100);
    });
    it("全成功时 forceExitDelayMs = 0", async () => {
        lm.register("testComp", mock);
        await lm.bootstrap();
        const memory = mockMemory();
        const warden = new ShutdownWarden(lm, memory, undefined, 5000, 500);
        const report = await warden.shutdown();
        expect(report.forceExitDelayMs).toBe(0);
    });
    it("自定义 timeoutMs 生效", async () => {
        // 组件 stop 很快，不应超时
        lm.register("testComp", mock);
        await lm.bootstrap();
        const warden = new ShutdownWarden(lm, undefined, undefined, 10000, 0);
        const report = await warden.shutdown();
        expect(report.failedComponents).toHaveLength(0);
    });
    it("lifecycleManager shutdown 失败时仍继续执行 memory 清理", async () => {
        // 注册一个会在 stop 时抛错的组件
        const badMock = new MockLifecycle();
        badMock.setStop(async () => { throw new Error("STOP_FAIL"); });
        lm.register("badComp", badMock);
        await lm.bootstrap();
        const memory = mockMemory();
        const endSessionSpy = vi.spyOn(memory, "endSession");
        const closeSpy = vi.spyOn(memory, "close");
        const warden = new ShutdownWarden(lm, memory, undefined, 5000, 0);
        const report = await warden.shutdown();
        // LifecycleManager 内部已处理 stop 失败，shutdown 不抛异常
        // 但 memory 清理仍执行
        expect(endSessionSpy).toHaveBeenCalledTimes(1);
        expect(closeSpy).toHaveBeenCalledTimes(1);
        expect(report.endSessionDone).toBe(true);
    });
    it("stopDurationMs 反映实际耗时", async () => {
        lm.register("testComp", mock);
        await lm.bootstrap();
        const warden = new ShutdownWarden(lm, undefined);
        const start = Date.now();
        const report = await warden.shutdown();
        const elapsed = Date.now() - start;
        // stopDurationMs 应 >= 0 且 <= 实际耗时
        expect(report.stopDurationMs).toBeGreaterThanOrEqual(0);
        expect(report.stopDurationMs).toBeLessThanOrEqual(elapsed + 50);
    });
});
//# sourceMappingURL=shutdown-warden.test.js.map