import type { MemoryStorage } from "./storage.js";

/**
 * MemoryLifecycle —— 记忆三态状态机 (v3)。
 *
 * 职责：
 * - 状态转移规则校验（isValidTransition）
 * - CAS 原子状态变更
 * - archive / obliterate 操作
 *
 * 状态流转图（v3——三态）：
 *   Active  → Archived     (archive)
 *   Active  → Obliterated  (obliterate)
 *   Archived → Obliterated (obliterate)
 */
export class MemoryLifecycle {
  private static readonly ACTIVE = "Active";
  private static readonly ARCHIVED = "Archived";
  private static readonly OBLITERATED = "Obliterated";

  static isValidTransition(from: string, to: string): boolean {
    if (from === MemoryLifecycle.OBLITERATED) return false;
    // 复活保护
    if (to === MemoryLifecycle.ACTIVE && from !== MemoryLifecycle.ACTIVE) return false;
    return true;
  }

  cas(
    storage: MemoryStorage,
    id: string,
    expected: string,
    newState: string,
    persistFn?: (id: string, state: string) => void,
  ): boolean {
    const m = storage.memories.get(id);
    if (!m) return false;
    if (m.semantic_state !== expected) return false;

    if (!MemoryLifecycle.isValidTransition(m.semantic_state, newState)) return false;

    m.semantic_state = newState as MemoryEntry["semantic_state"];

    if (persistFn) {
      try {
        persistFn(id, newState);
      } catch (e) {
        m.semantic_state = expected as MemoryEntry["semantic_state"];
        throw e;
      }
    }

    return true;
  }

  archive(
    storage: MemoryStorage,
    id: string,
    persistFn?: (id: string, state: string) => void,
  ): boolean {
    return this.cas(storage, id, MemoryLifecycle.ACTIVE, MemoryLifecycle.ARCHIVED, persistFn);
  }

  /** Pending 两阶段提交（用于 writePending/commitMemory 的内部实现） */
  markPending(
    _storage: MemoryStorage,
    _id: string,
    _persistFn?: (id: string, state: string) => void,
  ): boolean {
    // v3: Pending 是工程态，不改变语义态——直接返回 true
    return true;
  }

  commit(
    storage: MemoryStorage,
    id: string,
    persistFn?: (id: string, state: string) => void,
  ): boolean {
    // v3: commit 确认语义态为 Active
    const m = storage.memories.get(id);
    if (!m) return false;
    m.semantic_state = "Active";
    if (persistFn) {
      persistFn(id, "Active");
    }
    return true;
  }

  freeze(
    storage: MemoryStorage,
    id: string,
    persistFn?: (id: string, state: string) => void,
  ): boolean {
    // v3: freeze 转为 archive
    const m = storage.memories.get(id);
    if (!m) return false;
    if (m.semantic_state === "Archived") return true;
    return this.cas(storage, id, m.semantic_state, MemoryLifecycle.ARCHIVED, persistFn);
  }

  obliterate(
    storage: MemoryStorage,
    id: string,
    persistFn?: (id: string, state: string) => void,
  ): boolean {
    const m = storage.memories.get(id);
    if (!m) return false;
    if (m.semantic_state === MemoryLifecycle.OBLITERATED) return true;

    if (!MemoryLifecycle.isValidTransition(m.semantic_state, MemoryLifecycle.OBLITERATED)) return false;

    const previousState = m.semantic_state;
    m.semantic_state = "Obliterated";

    if (persistFn) {
      try {
        persistFn(id, MemoryLifecycle.OBLITERATED);
      } catch (e) {
        m.semantic_state = previousState;
        throw e;
      }
    }

    return true;
  }
}

import type { MemoryEntry } from "@cortex/shared";
