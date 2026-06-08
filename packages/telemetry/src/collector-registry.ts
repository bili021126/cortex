// ============================================================
// @cortex/telemetry —— CollectorRegistry
//
// 遥测采集器注册表——管理 Collector 的注册、查找和生命周期。
// 支持直接注册实例和惰性初始化（工厂模式）。
// ============================================================

import type {
  ITelemetryCollector,
  ICollectorRegistry,
  CollectorRegistration,
  CollectorFactory,
} from "./types.js";

// ─── CollectorRegistry ─────────────────────────────

/**
 * Collector 注册表实现。
 *
 * 管理 Collector 的注册、按名称查找、注销和批量生命周期操作。
 * 支持两种注册方式：
 * 1. register(collector) —— 注册已初始化的实例
 * 2. registerFactory(name, factory) —— 注册工厂函数，get() 时惰性初始化
 *
 * @example
 * ```typescript
 * const registry = new CollectorRegistry();
 * registry.register(new ConsoleCollector());
 * registry.registerFactory("file", () => new FileCollector("./telemetry/logs.jsonl"));
 *
 * const collector = registry.get("console"); // 返回已注册实例
 * const fileCollector = registry.get("file"); // 自动创建并缓存实例
 * ```
 */
export class CollectorRegistry implements ICollectorRegistry {
  /** 内部注册表存储 */
  private readonly _registrations: Map<string, CollectorRegistration> = new Map();

  /**
   * 注册一个已初始化的 Collector 实例。
   * @param collector - Collector 实例
   * @throws 如果名称已被注册且实例不同，抛出错误
   */
  register(collector: ITelemetryCollector): void {
    const existing = this._registrations.get(collector.name);
    if (existing && existing.collector !== collector) {
      throw new Error(
        `Collector "${collector.name}" is already registered with a different instance`,
      );
    }

    this._registrations.set(collector.name, {
      name: collector.name,
      collector,
      initialized: true,
    });
  }

  /**
   * 注册一个 Collector 工厂函数（惰性初始化）。
   * 首次调用 get() 时自动创建实例并缓存。
   *
   * @param name - 采集器名称
   * @param factory - 工厂函数
   * @throws 如果名称已被注册，抛出错误
   */
  registerFactory(name: string, factory: CollectorFactory): void {
    if (this._registrations.has(name)) {
      throw new Error(`Collector factory "${name}" is already registered`);
    }

    this._registrations.set(name, {
      name,
      collector: factory,
      initialized: false,
    });
  }

  /**
   * 按名称查找 Collector。
   * 如果是工厂注册且尚未初始化，自动调用工厂创建实例。
   *
   * @param name - 采集器名称
   * @returns Collector 实例，或 undefined（未注册）
   */
  get(name: string): ITelemetryCollector | undefined {
    const registration = this._registrations.get(name);
    if (!registration) {
      return undefined;
    }

    // 已初始化，直接返回
    if (registration.initialized) {
      return registration.collector;
    }

    // 工厂模式——惰性初始化
    const instance = registration.collector();
    this._registrations.set(name, {
      name,
      collector: instance,
      initialized: true,
    });

    return instance;
  }

  /**
   * 注销 Collector。
   * 如果 Collector 已初始化，先调用其 shutdown() 再移除。
   *
   * @param name - 采集器名称
   */
  async unregister(name: string): Promise<void> {
    const registration = this._registrations.get(name);
    if (!registration) {
      return;
    }

    if (registration.initialized) {
      const collector = registration.collector;
      await collector.shutdown();
    }

    this._registrations.delete(name);
  }

  /**
   * 获取所有已注册的 Collector 名称。
   * @returns 名称列表（按注册顺序）
   */
  getNames(): readonly string[] {
    return Array.from(this._registrations.keys());
  }

  /**
   * 刷新所有已初始化的 Collector。
   */
  async flushAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const registration of this._registrations.values()) {
      if (registration.initialized) {
        promises.push(registration.collector.flush());
      }
    }

    await Promise.all(promises);
  }

  /**
   * 关闭并注销所有已初始化的 Collector。
   */
  async shutdownAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const registration of this._registrations.values()) {
      if (registration.initialized) {
        promises.push(registration.collector.shutdown());
      }
    }

    await Promise.all(promises);
    this._registrations.clear();
  }
}
