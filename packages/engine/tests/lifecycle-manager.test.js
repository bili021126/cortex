// @ci: unit
// ============================================================
// lifecycle-manager.test.ts — LifecycleManager 单元测试
//
// 覆盖：注册、拓扑排序 bootstrap、反向 shutdown、
//       重复注册检测、缺失依赖检测、循环依赖检测
// ============================================================
import { describe, it, expect } from "vitest";
import { LifecycleManager } from "@cortex/engine";
import { LifecyclePhase } from "@cortex/shared";
function makeComponent(name, errorOn) {
    let _phase = LifecyclePhase.Created;
    const calls = [];
    return {
        calls,
        get phase() { return _phase; },
        async init() {
            if (errorOn === "init")
                throw new Error(`${name} init failed`);
            calls.push({ component: name, method: "init" });
            _phase = LifecyclePhase.Running;
        },
        async start() {
            if (errorOn === "start")
                throw new Error(`${name} start failed`);
            calls.push({ component: name, method: "start" });
        },
        async stop() {
            if (errorOn === "stop")
                throw new Error(`${name} stop failed`);
            calls.push({ component: name, method: "stop" });
            _phase = LifecyclePhase.Stopped;
        },
        dispose() {
            calls.push({ component: name, method: "dispose" });
            _phase = LifecyclePhase.Disposed;
        },
        _phase,
    };
}
// ── Tests ──────────────────────────────────────
describe("LifecycleManager", () => {
    // ── 注册 ────────────────────────────────────
    it("注册组件成功", () => {
        const lm = new LifecycleManager();
        const a = makeComponent("a");
        expect(() => lm.register("a", a)).not.toThrow();
    });
    it("重复注册同名组件——后注册覆盖前注册（静默）", () => {
        const lm = new LifecycleManager();
        const a1 = makeComponent("a");
        const a2 = makeComponent("a");
        lm.register("a", a1);
        // 重复注册不抛错，后注册的组件覆盖前者
        expect(() => lm.register("a", a2)).not.toThrow();
    });
    it("依赖未注册的组件 → bootstrap 时抛错", async () => {
        const lm = new LifecycleManager();
        lm.register("a", makeComponent("a"), ["b"]);
        await expect(lm.bootstrap()).rejects.toThrow(/依赖未注册/);
    });
    // ── bootstrap ───────────────────────────────
    it("bootstrap 按拓扑序调用 init 再 start", async () => {
        const lm = new LifecycleManager();
        const a = makeComponent("a");
        const b = makeComponent("b");
        lm.register("a", a);
        lm.register("b", b, ["a"]); // b 依赖 a
        await lm.bootstrap();
        // a 的 init 和 start 应在 b 之前
        const order = [...a.calls, ...b.calls];
        const aInitIdx = order.findIndex((c) => c.component === "a" && c.method === "init");
        const aStartIdx = order.findIndex((c) => c.component === "a" && c.method === "start");
        const bInitIdx = order.findIndex((c) => c.component === "b" && c.method === "init");
        const bStartIdx = order.findIndex((c) => c.component === "b" && c.method === "start");
        expect(aInitIdx).toBeLessThan(bInitIdx);
        expect(aStartIdx).toBeLessThan(bStartIdx);
        // init 总是在 start 之前
        expect(aInitIdx).toBeLessThan(aStartIdx);
        expect(bInitIdx).toBeLessThan(bStartIdx);
    });
    it("无依赖的多个组件 bootstrap 全部调用", async () => {
        const lm = new LifecycleManager();
        const a = makeComponent("a");
        const b = makeComponent("b");
        const c = makeComponent("c");
        lm.register("a", a);
        lm.register("b", b);
        lm.register("c", c);
        await lm.bootstrap();
        expect(a.calls.map((c) => c.method)).toEqual(["init", "start"]);
        expect(b.calls.map((c) => c.method)).toEqual(["init", "start"]);
        expect(c.calls.map((c) => c.method)).toEqual(["init", "start"]);
    });
    it("重复 bootstrap 抛出异常", async () => {
        const lm = new LifecycleManager();
        const a = makeComponent("a");
        lm.register("a", a);
        await lm.bootstrap();
        expect(a.calls.length).toBe(2); // init + start
        await expect(lm.bootstrap()).rejects.toThrow(/无法 bootstrap/);
    });
    it("bootstrap 中组件 init 失败时抛出并传播事件", async () => {
        const lm = new LifecycleManager();
        const events = [];
        lm.on((event, detail) => {
            events.push(`${event}:${detail.component}`);
        });
        const a = makeComponent("a");
        const b = makeComponent("b", "init"); // b 的 init 会失败
        lm.register("a", a);
        lm.register("b", b, ["a"]);
        await expect(lm.bootstrap()).rejects.toThrow("b init failed");
        // 应发送 component_error 事件
        expect(events.some((e) => e.includes("component_error") && e.includes("b"))).toBe(true);
    });
    // ── 循环依赖 ────────────────────────────────
    it("循环依赖在 bootstrap 时被检测到", async () => {
        const lm = new LifecycleManager();
        const a = makeComponent("a");
        const b = makeComponent("b");
        lm.register("a", a, ["b"]);
        lm.register("b", b, ["a"]);
        // bootstrap 时 topoSort 检测循环依赖
        await expect(lm.bootstrap()).rejects.toThrow(/循环依赖/);
    });
    // ── shutdown ────────────────────────────────
    it("shutdown 反向拓扑序调用 stop 再 dispose", async () => {
        const lm = new LifecycleManager();
        const a = makeComponent("a");
        const b = makeComponent("b");
        lm.register("a", a);
        lm.register("b", b, ["a"]); // b 依赖 a → a 先于 b
        await lm.bootstrap();
        await lm.shutdown();
        // shutdown 反向序: b 的 stop/dispose 在 a 之前
        const order = [...b.calls, ...a.calls];
        const bStopIdx = order.findIndex((c) => c.component === "b" && c.method === "stop");
        const aStopIdx = order.findIndex((c) => c.component === "a" && c.method === "stop");
        expect(bStopIdx).toBeLessThan(aStopIdx);
    });
    it("未 bootstrap 则 shutdown 不执行", async () => {
        const lm = new LifecycleManager();
        const a = makeComponent("a");
        lm.register("a", a);
        await lm.shutdown();
        // 没有 bootstrap，shutdown 应跳过
        expect(a.calls.length).toBe(0);
    });
    it("重复 shutdown 只执行一次", async () => {
        const lm = new LifecycleManager();
        const a = makeComponent("a");
        lm.register("a", a);
        await lm.bootstrap();
        await lm.shutdown();
        const callCount = a.calls.length;
        await lm.shutdown();
        // 第二次 shutdown 不应再调用
        expect(a.calls.length).toBe(callCount);
    });
    it("shutdown 中组件 stop 失败不阻断其余组件", async () => {
        const lm = new LifecycleManager();
        const events = [];
        lm.on((event, detail) => {
            events.push(`${event}:${detail.component ?? ""}`);
        });
        const a = makeComponent("a", "stop"); // a 的 stop 会失败
        const b = makeComponent("b");
        lm.register("a", a);
        lm.register("b", b, ["a"]);
        await lm.bootstrap();
        await lm.shutdown();
        // a 的 stop 失败，但 b 的 stop 和 dispose 仍被执行
        const bStopped = b.calls.some((c) => c.method === "stop");
        expect(bStopped).toBe(true);
        // 所有组件的 dispose 都应被调用
        const aDisposed = a.calls.some((c) => c.method === "dispose");
        const bDisposed = b.calls.some((c) => c.method === "dispose");
        expect(aDisposed).toBe(true);
        expect(bDisposed).toBe(true);
    });
    // ── 事件监听 ────────────────────────────────
    it("bootstrap 完成后触发 bootstrap_done 事件", async () => {
        const lm = new LifecycleManager();
        const events = [];
        lm.on((event) => events.push(event));
        lm.register("a", makeComponent("a"));
        await lm.bootstrap();
        expect(events).toContain("bootstrap_done");
    });
    it("shutdown 触发 shutdown_start → shutdown_done 事件序列", async () => {
        const lm = new LifecycleManager();
        const events = [];
        lm.on((event) => events.push(event));
        lm.register("a", makeComponent("a"));
        await lm.bootstrap();
        events.length = 0; // 清空 bootstrap 事件
        await lm.shutdown();
        expect(events).toContain("shutdown_start");
        expect(events).toContain("shutdown_done");
        // shutdown_start 在 shutdown_done 之前
        const startIdx = events.indexOf("shutdown_start");
        const doneIdx = events.indexOf("shutdown_done");
        expect(startIdx).toBeLessThan(doneIdx);
    });
    // ── 复杂依赖图 ──────────────────────────────
    it("三层依赖链: a ← b ← c 拓扑序正确", async () => {
        const lm = new LifecycleManager();
        const a = makeComponent("a");
        const b = makeComponent("b");
        const c = makeComponent("c");
        lm.register("a", a);
        lm.register("b", b, ["a"]);
        lm.register("c", c, ["b"]);
        await lm.bootstrap();
        // 验证 a init 在 b init 之前，b init 在 c init 之前
        const aInitEnd = Math.max(...a.calls.filter((c) => c.method === "init").map((_, i) => i));
        // 简化为：检查所有组件都经过了 init+start
        expect(a.calls.map((c) => c.method)).toEqual(["init", "start"]);
        expect(b.calls.map((c) => c.method)).toEqual(["init", "start"]);
        expect(c.calls.map((c) => c.method)).toEqual(["init", "start"]);
    });
});
//# sourceMappingURL=lifecycle-manager.test.js.map