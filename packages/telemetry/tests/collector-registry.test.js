// @ci: unit
// ============================================================
// @cortex/telemetry —— CollectorRegistry 单元测试
// ============================================================
import { describe, it, expect, beforeEach, vi } from "vitest";
import { CollectorRegistry } from "../src/index.js";
// ─── Mock Collector ───────────────────────────────
class MockCollector {
    name;
    collectCount = 0;
    flushCount = 0;
    shutdownCount = 0;
    _shutdown = false;
    constructor(name) {
        this.name = name;
    }
    async collect(_data) {
        if (this._shutdown) {
            return { accepted: false, reason: "shutdown" };
        }
        this.collectCount++;
        return { accepted: true };
    }
    async flush() {
        this.flushCount++;
    }
    async shutdown() {
        this.shutdownCount++;
        this._shutdown = true;
    }
}
// ─── Tests ────────────────────────────────────────
describe("CollectorRegistry", () => {
    let registry;
    beforeEach(() => {
        registry = new CollectorRegistry();
    });
    describe("register", () => {
        it("should register a collector instance", () => {
            const collector = new MockCollector("test-collector");
            registry.register(collector);
            const names = registry.getNames();
            expect(names).toContain("test-collector");
        });
        it("should allow retrieving a registered collector", () => {
            const collector = new MockCollector("my-collector");
            registry.register(collector);
            const retrieved = registry.get("my-collector");
            expect(retrieved).toBe(collector);
        });
        it("should throw when registering a different instance with same name", () => {
            const collector1 = new MockCollector("dup");
            const collector2 = new MockCollector("dup");
            registry.register(collector1);
            expect(() => registry.register(collector2)).toThrow("already registered");
        });
        it("should allow re-registering the same instance", () => {
            const collector = new MockCollector("same-instance");
            registry.register(collector);
            expect(() => registry.register(collector)).not.toThrow();
        });
    });
    describe("registerFactory", () => {
        it("should register a factory function", () => {
            const factory = () => new MockCollector("factory-collector");
            registry.registerFactory("factory-collector", factory);
            expect(registry.getNames()).toContain("factory-collector");
        });
        it("should lazily initialize on first get()", () => {
            const createFn = vi.fn(() => new MockCollector("lazy"));
            registry.registerFactory("lazy", createFn);
            expect(createFn).not.toHaveBeenCalled();
            const collector = registry.get("lazy");
            expect(collector).toBeDefined();
            expect(createFn).toHaveBeenCalledTimes(1);
        });
        it("should return the same instance on subsequent get() calls", () => {
            const factory = () => new MockCollector("cached");
            registry.registerFactory("cached", factory);
            const first = registry.get("cached");
            const second = registry.get("cached");
            expect(first).toBe(second);
        });
        it("should throw when registering a factory with an existing name", () => {
            registry.register(new MockCollector("existing"));
            expect(() => registry.registerFactory("existing", () => new MockCollector("existing")))
                .toThrow("already registered");
        });
    });
    describe("get", () => {
        it("should return undefined for unknown name", () => {
            const result = registry.get("nonexistent");
            expect(result).toBeUndefined();
        });
        it("should return registered instance", () => {
            const collector = new MockCollector("known");
            registry.register(collector);
            expect(registry.get("known")).toBe(collector);
        });
    });
    describe("unregister", () => {
        it("should remove a registered collector and call shutdown", async () => {
            const collector = new MockCollector("to-remove");
            registry.register(collector);
            await registry.unregister("to-remove");
            expect(registry.get("to-remove")).toBeUndefined();
            expect(collector.shutdownCount).toBe(1);
        });
        it("should not throw when unregistering a non-existent collector", async () => {
            await expect(registry.unregister("non-existent")).resolves.toBeUndefined();
        });
        it("should not call shutdown on factory that was never initialized", async () => {
            registry.registerFactory("uninitialized", () => new MockCollector("uninitialized"));
            await registry.unregister("uninitialized");
            // After unregister, factory should be removed
            expect(registry.get("uninitialized")).toBeUndefined();
        });
    });
    describe("getNames", () => {
        it("should return empty array for new registry", () => {
            expect(registry.getNames()).toEqual([]);
        });
        it("should return all registered names", () => {
            registry.register(new MockCollector("a"));
            registry.register(new MockCollector("b"));
            registry.registerFactory("c", () => new MockCollector("c"));
            const names = registry.getNames();
            expect(names).toContain("a");
            expect(names).toContain("b");
            expect(names).toContain("c");
            expect(names).toHaveLength(3);
        });
    });
    describe("flushAll", () => {
        it("should flush all initialized collectors", async () => {
            const collectorA = new MockCollector("a");
            const collectorB = new MockCollector("b");
            registry.register(collectorA);
            registry.register(collectorB);
            await registry.flushAll();
            expect(collectorA.flushCount).toBe(1);
            expect(collectorB.flushCount).toBe(1);
        });
        it("should not initialize factory collectors", async () => {
            const factory = vi.fn(() => new MockCollector("lazy"));
            registry.registerFactory("lazy", factory);
            await registry.flushAll();
            expect(factory).not.toHaveBeenCalled();
        });
    });
    describe("shutdownAll", () => {
        it("should shut down all initialized collectors and clear registry", async () => {
            const collectorA = new MockCollector("a");
            const collectorB = new MockCollector("b");
            registry.register(collectorA);
            registry.register(collectorB);
            await registry.shutdownAll();
            expect(collectorA.shutdownCount).toBe(1);
            expect(collectorB.shutdownCount).toBe(1);
            expect(registry.getNames()).toEqual([]);
        });
        it("should handle empty registry gracefully", async () => {
            await expect(registry.shutdownAll()).resolves.toBeUndefined();
        });
    });
});
//# sourceMappingURL=collector-registry.test.js.map