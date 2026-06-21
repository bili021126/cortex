// ============================================================
// @cortex/memory — MemoryStoreRegistry 注册表+工厂模式
//
// 记忆存储实例的统一注册中心。借鉴 @cortex/telemetry 的
// ICollectorRegistry 设计，实现按名称注册/查找/切换存储实例。
//
// @design 三层注册架构
//   1. register(): 注册已初始化的 IMemoryStore 实例
//   2. registerFactory(): 注册工厂函数，首次 get() 时自动创建
//   3. switchDefault(): 切换默认存储实例
//
// @discriminated-union StoreRegistration
//   使用 discriminated union（initialized: true/false）窄化
//   存储实例的初始化状态。
//
// @example
// ```typescript
// const registry = new MemoryStoreRegistry();
//
// // 注册内存存储
// registry.register("default", new InMemoryMemoryStore());
//
// // 注册文件存储（惰性初始化）
// registry.registerFactory("persistent", () => {
//   const store = new FileBasedMemoryStore();
//   await store.init("./data");
//   return store;
// });
//
// // 切换默认
// await registry.switchDefault("persistent");
// ```
// ============================================================
import { StoreNotFoundError, StoreAlreadyExistsError, } from "../errors/MemoryStoreError.js";
/**
 * MemoryStoreRegistry —— 记忆存储实例的注册中心。
 *
 * 管理 IMemoryStore 实例的注册、查找、切换和生命周期。
 * 支持直接注册实例和注册工厂函数（惰性初始化）。
 *
 * @remarks
 * 设计借鉴 @cortex/telemetry 的 ICollectorRegistry：
 * - register(): 注册已初始化的 IMemoryStore 实例
 * - registerFactory(): 注册工厂函数，首次 get() 时调用
 * - get(): 按名称查找（工厂模式自动初始化并缓存）
 * - switchDefault(): 切换默认存储实例
 * - 所有公开方法均通过 barrel 导出
 *
 * @example
 * ```typescript
 * const registry = new MemoryStoreRegistry();
 *
 * // 注册内存存储（默认）
 * registry.register("default", new InMemoryMemoryStore());
 *
 * // 获取
 * const store = registry.get("default");
 * ```
 */
export class MemoryStoreRegistry {
    /** 注册存储实例的 Map */
    _registrations = new Map();
    /** 当前默认存储的名称 */
    _defaultName;
    // ── 注册方法 ──
    /**
     * 注册一个已初始化的 IMemoryStore 实例。
     *
     * @param name - 注册名称（全局唯一，大小写敏感）
     * @param store - 已初始化的 IMemoryStore 实例
     * @throws {StoreAlreadyExistsError} 如果 name 已注册（同一实例除外）
     *
     * @example
     * ```typescript
     * registry.register("default", new InMemoryMemoryStore());
     * ```
     */
    register(name, store) {
        const existing = this._registrations.get(name);
        if (existing && existing.initialized && existing.store !== store) {
            throw new StoreAlreadyExistsError(name);
        }
        this._registrations.set(name, {
            name,
            store,
            initialized: true,
        });
        if (!this._defaultName) {
            this._defaultName = name;
        }
    }
    /**
     * 注册一个 IMemoryStore 工厂函数（惰性初始化）。
     *
     * 工厂函数在首次 get() 被调用时执行，之后缓存创建的实例。
     *
     * @param name - 注册名称（全局唯一）
     * @param factory - 工厂函数，返回 IMemoryStore 实例
     * @throws {StoreAlreadyExistsError} 如果 name 已注册
     *
     * @example
     * ```typescript
     * registry.registerFactory("persistent", async () => {
     *   const store = new FileBasedMemoryStore();
     *   await store.init("./memory-data");
     *   return store;
     * });
     * ```
     */
    registerFactory(name, factory) {
        if (this._registrations.has(name)) {
            throw new StoreAlreadyExistsError(name);
        }
        this._registrations.set(name, {
            name,
            factory,
            initialized: false,
        });
        if (!this._defaultName) {
            this._defaultName = name;
        }
    }
    // ── 查找方法 ──
    /**
     * 按名称查找存储实例。
     *
     * 如果是工厂注册且尚未初始化，自动调用工厂创建实例并缓存。
     *
     * @param name - 注册名称
     * @returns IMemoryStore 实例，如果未注册返回 undefined
     *
     * @example
     * ```typescript
     * const store = registry.get("default");
     * if (store) {
     *   await store.write({ ... });
     * }
     * ```
     */
    async get(name) {
        const registration = this._registrations.get(name);
        if (!registration)
            return undefined;
        if (registration.initialized) {
            return registration.store;
        }
        // 惰性初始化：调用工厂并缓存
        const store = await registration.factory();
        this._registrations.set(name, {
            name,
            store,
            initialized: true,
        });
        return store;
    }
    /**
     * 获取当前默认的存储实例。
     *
     * @returns 默认的 IMemoryStore 实例
     * @throws {StoreNotFoundError} 如果没有注册任何存储
     */
    async getDefault() {
        if (!this._defaultName) {
            throw new StoreNotFoundError("(no default store registered)");
        }
        const store = await this.get(this._defaultName);
        if (!store) {
            // 理论上不应发生，但做防御性处理
            throw new StoreNotFoundError(this._defaultName);
        }
        return store;
    }
    // ── 切换方法 ──
    /**
     * 切换默认存储实例。
     *
     * @param name - 已注册的存储名称
     * @throws {StoreNotFoundError} 如果 name 未注册
     *
     * @example
     * ```typescript
     * await registry.switchDefault("persistent");
     * ```
     */
    switchDefault(name) {
        if (!this._registrations.has(name)) {
            throw new StoreNotFoundError(name);
        }
        this._defaultName = name;
    }
    // ── 注销方法 ──
    /**
     * 注销存储实例并关闭。
     *
     * 如果实例已初始化，调用其 close() 方法后再移除。
     *
     * @param name - 注册名称
     *
     * @example
     * ```typescript
     * await registry.unregister("persistent");
     * ```
     */
    async unregister(name) {
        const registration = this._registrations.get(name);
        if (!registration)
            return;
        if (registration.initialized) {
            try {
                await registration.store.close();
            }
            catch (err) {
                // 关闭失败不阻止注销，但必须记录
                console.warn(`[MemoryStoreRegistry] unregister close failed for "${name}":`, err);
            }
        }
        this._registrations.delete(name);
        // 如果被注销的是默认存储，重置默认
        if (this._defaultName === name) {
            this._defaultName = this._registrations.size > 0
                ? this._registrations.keys().next().value
                : undefined;
        }
    }
    // ── 查询方法 ──
    /**
     * 获取所有已注册的存储名称列表。
     *
     * @returns 只读的名称数组
     */
    getNames() {
        return Array.from(this._registrations.keys());
    }
    /**
     * 检查指定名称的存储是否已注册。
     *
     * @param name - 注册名称
     * @returns 是否已注册
     */
    has(name) {
        return this._registrations.has(name);
    }
    /**
     * 检查指定名称的存储是否已初始化。
     *
     * @param name - 注册名称
     * @returns 如果已注册且已初始化则返回 true
     */
    isInitialized(name) {
        const registration = this._registrations.get(name);
        return registration?.initialized ?? false;
    }
    // ── 批量操作 ──
    /**
     * 刷新所有已初始化的存储实例。
     *
     * 工厂注册但尚未初始化的实例不会被初始化。
     */
    async flushAll() {
        const promises = [];
        for (const registration of this._registrations.values()) {
            if (registration.initialized) {
                promises.push(registration.store.flush());
            }
        }
        await Promise.all(promises);
    }
    /**
     * 关闭并注销所有已初始化的存储实例。
     *
     * 执行后注册表将被清空。
     */
    async shutdownAll() {
        const promises = [];
        for (const registration of this._registrations.values()) {
            if (registration.initialized) {
                promises.push(registration.store.close().catch((err) => {
                    console.warn(`[MemoryStoreRegistry] shutdownAll close failed for "${registration.name}":`, err);
                }));
            }
        }
        await Promise.all(promises);
        this._registrations.clear();
        this._defaultName = undefined;
    }
}
//# sourceMappingURL=MemoryStoreRegistry.js.map