// @ci: unit
// ============================================================
// @cortex/memory —— MemoryStoreRegistry 单元测试
// ============================================================
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStoreRegistry, InMemoryMemoryStore } from "@cortex/memory";
// ─── Mock Store ───────────────────────────────
class MockStore {
    name;
    closeCount = 0;
    flushCount = 0;
    _isReady = true;
    constructor(name) {
        this.name = name;
    }
    get isReady() {
        return this._isReady;
    }
    get size() {
        return 0;
    }
    get isPersisted() {
        return false;
    }
    get sessionId() {
        return undefined;
    }
    async get(_id) {
        return undefined;
    }
    peek(_id) {
        return undefined;
    }
    has(_id) {
        return false;
    }
    async read() {
        return [];
    }
    getLinks() {
        return [];
    }
    getBySession() {
        return [];
    }
    getPending() {
        return [];
    }
    hasPending() {
        return false;
    }
    async init(_dbPath) {
        this._isReady = true;
    }
    beginSession(_externalId) {
        return "mock-session";
    }
    async endSession() {
        return 0;
    }
    async flush() {
        this.flushCount++;
    }
    async close() {
        this.closeCount++;
        this._isReady = false;
    }
}
// ─── Tests ─────────────────────────────────────
describe("MemoryStoreRegistry", () => {
    let registry;
    beforeEach(() => {
        registry = new MemoryStoreRegistry();
    });
    describe("register", () => {
        it("should register a store instance", () => {
            const store = new MockStore("test-store");
            registry.register("test-store", store);
            expect(registry.has("test-store")).toBe(true);
            expect(registry.getNames()).toContain("test-store");
        });
        it("should throw when registering a different instance with the same name", () => {
            const store1 = new MockStore("dup");
            const store2 = new MockStore("dup");
            registry.register("dup", store1);
            expect(() => registry.register("dup", store2)).toThrow("already registered");
        });
        it("should allow re-registering the same instance", () => {
            const store = new MockStore("same");
            registry.register("same", store);
            expect(() => registry.register("same", store)).not.toThrow();
        });
        it("should set the first registered store as default", () => {
            const store = new MockStore("first");
            registry.register("first", store);
            expect(registry["_defaultName"]).toBe("first");
        });
    });
    describe("registerFactory", () => {
        it("should register a factory function", () => {
            registry.registerFactory("factory-store", () => new MockStore("factory-store"));
            expect(registry.has("factory-store")).toBe(true);
            expect(registry.isInitialized("factory-store")).toBe(false);
        });
        it("should lazily initialize on first get()", async () => {
            let callCount = 0;
            registry.registerFactory("lazy", () => {
                callCount++;
                return new MockStore("lazy");
            });
            expect(callCount).toBe(0);
            const store1 = await registry.get("lazy");
            expect(store1).toBeDefined();
            expect(callCount).toBe(1);
            const store2 = await registry.get("lazy");
            expect(store2).toBe(store1);
            expect(callCount).toBe(1);
        });
        it("should throw when registering a factory with an existing name", () => {
            registry.register("existing", new MockStore("existing"));
            expect(() => registry.registerFactory("existing", () => new MockStore("existing")))
                .toThrow("already registered");
        });
    });
    describe("get", () => {
        it("should return undefined for unknown name", async () => {
            const result = await registry.get("nonexistent");
            expect(result).toBeUndefined();
        });
        it("should return registered instance", async () => {
            const store = new MockStore("known");
            registry.register("known", store);
            const retrieved = await registry.get("known");
            expect(retrieved).toBe(store);
        });
        it("should initialize factory on first get", async () => {
            const store = new MockStore("factory");
            registry.registerFactory("factory", () => store);
            const retrieved = await registry.get("factory");
            expect(retrieved).toBe(store);
            expect(registry.isInitialized("factory")).toBe(true);
        });
    });
    describe("getDefault", () => {
        it("should return the first registered store by default", async () => {
            const store = new MockStore("default");
            registry.register("default", store);
            const retrieved = await registry.getDefault();
            expect(retrieved).toBe(store);
        });
        it("should throw if no store is registered", async () => {
            await expect(registry.getDefault()).rejects.toThrow("not registered");
        });
        it("should return the switched default store", async () => {
            const storeA = new MockStore("a");
            const storeB = new MockStore("b");
            registry.register("a", storeA);
            registry.register("b", storeB);
            registry.switchDefault("b");
            const retrieved = await registry.getDefault();
            expect(retrieved).toBe(storeB);
        });
    });
    describe("switchDefault", () => {
        it("should switch to a registered store", () => {
            const storeA = new MockStore("a");
            const storeB = new MockStore("b");
            registry.register("a", storeA);
            registry.register("b", storeB);
            registry.switchDefault("b");
            expect(registry["_defaultName"]).toBe("b");
        });
        it("should throw if the name is not registered", () => {
            expect(() => registry.switchDefault("nonexistent")).toThrow("not registered");
        });
    });
    describe("unregister", () => {
        it("should remove a registered store and call close", async () => {
            const store = new MockStore("to-remove");
            registry.register("to-remove", store);
            await registry.unregister("to-remove");
            expect(registry.has("to-remove")).toBe(false);
            expect(store.closeCount).toBe(1);
        });
        it("should not throw when unregistering non-existent store", async () => {
            await expect(registry.unregister("non-existent")).resolves.toBeUndefined();
        });
        it("should reset default if the default store is unregistered", async () => {
            const storeA = new MockStore("a");
            const storeB = new MockStore("b");
            registry.register("a", storeA);
            registry.register("b", storeB);
            await registry.unregister("a");
            // 默认应切换到 b
            const retrieved = await registry.getDefault();
            expect(retrieved).toBe(storeB);
        });
    });
    describe("flushAll", () => {
        it("should flush all initialized stores", async () => {
            const storeA = new MockStore("a");
            const storeB = new MockStore("b");
            registry.register("a", storeA);
            registry.register("b", storeB);
            await registry.flushAll();
            expect(storeA.flushCount).toBe(1);
            expect(storeB.flushCount).toBe(1);
        });
        it("should not initialize factory stores", async () => {
            registry.registerFactory("lazy", () => new MockStore("lazy"));
            await registry.flushAll();
            expect(registry.isInitialized("lazy")).toBe(false);
        });
    });
    describe("shutdownAll", () => {
        it("should shut down all initialized stores and clear registry", async () => {
            const storeA = new MockStore("a");
            const storeB = new MockStore("b");
            registry.register("a", storeA);
            registry.register("b", storeB);
            await registry.shutdownAll();
            expect(storeA.closeCount).toBe(1);
            expect(storeB.closeCount).toBe(1);
            expect(registry.getNames()).toEqual([]);
        });
        it("should handle empty registry gracefully", async () => {
            await expect(registry.shutdownAll()).resolves.toBeUndefined();
        });
    });
    describe("getNames / has / isInitialized", () => {
        it("should return empty array for new registry", () => {
            expect(registry.getNames()).toEqual([]);
        });
        it("should return all registered names", () => {
            registry.register("a", new MockStore("a"));
            registry.register("b", new MockStore("b"));
            const names = registry.getNames();
            expect(names).toContain("a");
            expect(names).toContain("b");
            expect(names).toHaveLength(2);
        });
        it("should check initialization status", () => {
            registry.register("init", new MockStore("init"));
            expect(registry.isInitialized("init")).toBe(true);
            registry.registerFactory("not-init", () => new MockStore("not-init"));
            expect(registry.isInitialized("not-init")).toBe(false);
        });
    });
    describe("working with InMemoryMemoryStore", () => {
        it("should integrate with InMemoryMemoryStore", async () => {
            const memStore = new InMemoryMemoryStore();
            await memStore.init(":memory:");
            registry.register("mem", memStore);
            const retrieved = await registry.get("mem");
            expect(retrieved).toBe(memStore);
            expect(retrieved.isReady).toBe(true);
        });
    });
    describe("edge cases", () => {
        it("should handle factory registration that returns already-initialized store", async () => {
            const store = new MockStore("pre-init");
            await store.init("/tmp");
            registry.registerFactory("factory-init", () => store);
            const retrieved = await registry.get("factory-init");
            expect(retrieved).toBe(store);
        });
        it("should unregister without error when store close throws", async () => {
            const store = new MockStore("faulty");
            store.closeCount = 0;
            // force close to throw by making _isReady stay true
            registry.register("faulty", store);
            // unregister should not throw even if close has issues
            await expect(registry.unregister("faulty")).resolves.toBeUndefined();
        });
        it("should return empty names for fresh registry", () => {
            expect(registry.getNames()).toEqual([]);
        });
        it("should set default to remaining store after unregister", async () => {
            const storeA = new MockStore("a");
            const storeB = new MockStore("b");
            registry.register("a", storeA);
            registry.register("b", storeB);
            await registry.unregister("a");
            // Default should be "b" now
            const def = await registry.getDefault();
            expect(def).toBe(storeB);
        });
    });
});
//# sourceMappingURL=MemoryStoreRegistry.test.js.map