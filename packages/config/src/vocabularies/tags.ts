// ============================================================
// @cortex/config — 标签词汇表（从 @cortex/shared 迁入）
//
// Tag 基础词汇表——预定义标签，保证向后兼容。
// Tag 现在是开放类型（string），运行时由 TagRegistry 校验合法性。
//
// TAG_VOCABULARY 由 @cortex/shared 单一持有（类型定义属于 shared）。
// 此处仅保留 TagRegistry（运行时注册属于 config）。
//
// Core-2: TagRegistry 支持链接到 AgentManifestStore 实现持久化。
// register() 调用的标签会自动写入 agent-manifests.json 的 _tags 主表。
// ============================================================

import { TAG_VOCABULARY as _TAG_VOCABULARY_BASE, type Tag } from "@cortex/shared";

/**
 * 标签基础词汇表——硬编码预定义标签，保证向后兼容。
 *
 * @deprecated 使用 {@link resolveTagVocabulary}() 作为新的单一真相源。
 * TAG_VOCABULARY 仅保留 shared 层 as const 硬编码基础集，
 * 不再包含 config 层持久化的动态标签。
 */
export const TAG_VOCABULARY: readonly string[] = _TAG_VOCABULARY_BASE;

export type { Tag };

/** AgentManifestStore 的最小接口——避免循环依赖 */
export interface TagPersistenceStore {
  getTagVocabulary(): string[];
  registerTag(tag: string): void;
  removeTag(tag: string): boolean;
}

/**
 * TagRegistry —— 运行时可注册的自定义标签。
 *
 * 支持可选的持久化后端（AgentManifestStore）。
 * 当 store 链接后，register() 同时写入 JSON 文件的 _tags 主表。
 */
export class TagRegistry {
  private _tags = new Set<string>(TAG_VOCABULARY);
  private _store: TagPersistenceStore | null = null;
  private _synced = false;

  /**
   * 链接持久化后端——从 agent-manifests.json 的 _tags 同步并持久化后续注册。
   * 仅在首次 setStore 时自动同步一次。
   */
  setStore(store: TagPersistenceStore | null): void {
    this._store = store;
    if (store && !this._synced) {
      this._syncFromStore(store);
      this._synced = true;
    }
  }

  /** 注册标签——内存 + 持久化 */
  register(tag: string): void {
    if (this._tags.has(tag)) return;
    this._tags.add(tag);
    if (this._store) {
      this._store.registerTag(tag);
    }
  }

  /** 检查标签是否存在 */
  has(tag: string): boolean {
    return this._tags.has(tag);
  }

  /** 获取所有标签 */
  getAll(): string[] {
    return [...this._tags];
  }

  /** 删除标签——内存 + 持久化（仅当无 agent 使用时成功） */
  remove(tag: string): boolean {
    if (this._store) {
      const persisted = this._store.removeTag(tag);
      if (persisted) {
        this._tags.delete(tag);
        return true;
      }
      return false;
    }
    this._tags.delete(tag);
    return true;
  }

  /** 重置标签集合（测试用） */
  _reset(): void {
    this._tags = new Set<string>(TAG_VOCABULARY);
    this._store = null;
    this._synced = false;
  }

  /** 从持久化 store 同步标签 */
  private _syncFromStore(store: TagPersistenceStore): void {
    try {
      const persisted = store.getTagVocabulary();
      for (const tag of persisted) {
        this._tags.add(tag);
      }
    } catch {
      // store 不可用时静默跳过
    }
  }
}

/** 全局单例 */
export const tagRegistry = new TagRegistry();

/**
 * resolveTagVocabulary —— 解析标签词汇表。
 *
 * 合并两来源：
 *   1. shared 的 TAG_VOCABULARY（硬编码基础集，向后兼容）
 *   2. TagRegistry 运行时注册的标签
 *
 * 返回去重排序的完整标签列表。
 */
export function resolveTagVocabulary(): string[] {
  const base = TAG_VOCABULARY;
  const runtime = tagRegistry.getAll();
  return [...new Set([...base, ...runtime])].sort();
}
