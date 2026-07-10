// ============================================================
// @cortex/config — 标签词汇表（从 @cortex/shared 迁入）
//
// Tag 基础词汇表——预定义标签，保证向后兼容。
// Tag 现在是开放类型（string），运行时由 TagRegistry 校验合法性。
//
// TAG_VOCABULARY 由 @cortex/shared 单一持有（类型定义属于 shared）。
// 此处仅保留 TagRegistry（运行时注册属于 config）。
// ============================================================

import { TAG_VOCABULARY, type Tag } from "@cortex/shared";
export { TAG_VOCABULARY, type Tag };

/**
 * TagRegistry —— 运行时可注册的自定义标签
 */
export class TagRegistry {
  private _tags = new Set<string>(TAG_VOCABULARY as unknown as readonly string[]);

  register(tag: string): void {
    this._tags.add(tag);
  }

  has(tag: string): boolean {
    return this._tags.has(tag);
  }

  getAll(): string[] {
    return [...this._tags];
  }
}

export const tagRegistry = new TagRegistry();
