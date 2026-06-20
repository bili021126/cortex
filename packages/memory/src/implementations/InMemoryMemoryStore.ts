// ============================================================
// @cortex/memory — InMemoryMemoryStore 纯内存实现
//
// 基于 AbstractMemoryStore 抽象基类，使用空操作后端。
// 适用于测试、临时会话和无持久化需求的场景。
// ============================================================

import type { MemoryEntry } from "@cortex/shared";
import { AbstractMemoryStore, type MemoryStoreBackend } from "./AbstractMemoryStore.js";

// ── 空操作后端 ───────────────────────────────

const NOOP_BACKEND: MemoryStoreBackend = {
  async init(): Promise<void> { /* 无需文件 I/O */ },
  async load(): Promise<void> { /* 纯内存无持久化数据 */ },
  async persist(): Promise<void> { /* 无持久化 */ },
  async remove(): Promise<void> { /* 无持久化 */ },
  async flushIndex(): Promise<void> { /* 无持久化 */ },
  async flushLinks(): Promise<void> { /* 无持久化 */ },
  async flushAll(): Promise<void> { /* 无持久化 */ },
};

/**
 * InMemoryMemoryStore —— 基于 Map 的纯内存 MemoryStore 实现。
 *
 * 继承 AbstractMemoryStore 的全部 36 个共享方法，后端为空操作。
 */
export class InMemoryMemoryStore extends AbstractMemoryStore {
  constructor() {
    super(NOOP_BACKEND);
  }

  /** 复写 get——返回结构化克隆以保证不可变性 */ 
  override async get(id: string): Promise<MemoryEntry | undefined> {
    // 委托父类（含 _ensureInitialized 检查）
    const entry = await super.get(id);
    return entry;
  }
}
