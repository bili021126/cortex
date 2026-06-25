// ============================================================
// @cortex/shared — IndexedRegistry<T> 泛型索引注册表基类
//
// 零运行时依赖，纯 TypeScript 泛型。
// 子类定义索引规则（defineIndexes），基类自动维护 items + indexes。
//
// 设计原则：
//   - 无 node:fs/path 等运行时依赖 → 可放在 shared
//   - 组件式/可插拔：子类通过 defineIndexes 声明索引
//   - 单 id 去重：register 已有 id 时自动 unregister
// ============================================================

/** 索引定义——子类通过 defineIndexes 声明 */
export interface IndexDefinition<T> {
  name: string;
  /** 提取索引键。返回字符串数组以支持一对多索引（如多标签） */
  extractKey: (item: T) => string | string[];
}

/**
 * 泛型索引注册表基类。
 *
 * @typeParam T 条目类型，必须包含 `id: string` 字段
 *
 * 子类职责：
 *   1. 调用 super() 或省略构造函数
 *   2. 实现 defineIndexes() 返回索引规则
 *   3. 可使用 queryByIndex(name, key) 查询
 */
export abstract class IndexedRegistry<T extends { id: string }> {
  /** 主存储——id → item */
  protected items = new Map<string, T>();
  /** 索引存储——indexName → key → Set<id> */
  protected indexes = new Map<string, Map<string, Set<string>>>();

  // ── 注册 / 注销 ─────────────────────────────────────

  /** 注册一个条目（有则覆盖——先清理旧索引再写入新条目） */
  register(item: T): void {
    if (this.items.has(item.id)) {
      this.unregister(item.id);
    }
    this.items.set(item.id, item);
    this.reindex(item);
  }

  /** 批量注册 */
  registerAll(items: T[]): void {
    for (const item of items) this.register(item);
  }

  /**
   * 注销条目。
   * 同时清理所有索引中的引用。
   */
  unregister(id: string): boolean {
    if (!this.items.has(id)) return false;
    // 从所有索引中移除该 id
    for (const [, idxMap] of this.indexes) {
      const emptyKeys: string[] = [];
      for (const [key, idSet] of idxMap) {
        idSet.delete(id);
        if (idSet.size === 0) emptyKeys.push(key);
      }
      for (const key of emptyKeys) idxMap.delete(key);
    }
    return this.items.delete(id);
  }

  // ── 查询 ────────────────────────────────────────────

  /** 按 id 获取 */
  get(id: string): T | undefined {
    return this.items.get(id);
  }

  /** 获取所有条目 */
  getAll(): T[] {
    return [...this.items.values()];
  }

  /** 清空所有条目与索引 */
  clear(): void {
    this.items.clear();
    this.indexes.clear();
  }

  // ── 子类扩展点 ────────────────────────────────────

  /** 子类定义索引规则 */
  protected abstract defineIndexes(): IndexDefinition<T>[];

  // ── 内部方法 ────────────────────────────────────────

  /** 为条目重建索引 */
  private reindex(item: T): void {
    for (const idx of this.defineIndexes()) {
      const raw = idx.extractKey(item);
      const keys = typeof raw === "string" ? [raw] : raw;
      for (const key of keys) {
        if (!key) continue;
        if (!this.indexes.has(idx.name)) {
          this.indexes.set(idx.name, new Map());
        }
        const idxMap = this.indexes.get(idx.name)!;
        if (!idxMap.has(key)) idxMap.set(key, new Set());
        idxMap.get(key)!.add(item.id);
      }
    }
  }

  /** 按索引名 + 键查询——返回匹配的条目列表 */
  protected queryByIndex(indexName: string, key: string): T[] {
    const ids = this.indexes.get(indexName)?.get(key);
    if (!ids) return [];
    return [...ids].map((id) => this.items.get(id)!).filter(Boolean);
  }
}
