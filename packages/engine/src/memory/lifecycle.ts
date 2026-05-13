import type { MemoryEntry } from "@cortex/shared";
import { MemoryState } from "@cortex/shared";
import type { MemoryStorage } from "./storage.js";

/**
 * MemoryLifecycle —— 记忆四态状态机。
 *
 * 职责：
 * - 状态转移规则校验（isValidTransition）
 * - CAS 原子状态变更
 * - archive / freeze / obliterate 操作
 *
 * 不负责：持久化（通过 persistFn 回调注入）、查询、BFS。
 */
export class MemoryLifecycle {
  /**
   * 校验状态转移是否合法。
   *
   * 规则：
   * - Obliterated 不可逆 → 拒绝所有转移
   * - 非 Active → Active   → 拒绝复活
   * - Frozen → 仅可 Obliterated
   */
  static isValidTransition(from: MemoryState, to: MemoryState): boolean {
    if (from === MemoryState.Obliterated) return false;
    if (from !== MemoryState.Active && to === MemoryState.Active) return false;
    if (from === MemoryState.Frozen && to !== MemoryState.Obliterated) return false;
    return true;
  }

  /**
   * CAS（Compare-And-Swap）原子状态变更。
   *
   * @returns true 如果转移成功；false 如果校验失败
   *
   * 治理判例 NG-2026-0509-Persist-False-Positive（假阳性禁止原则）：
   * persistFn 抛出时自动回滚 state。
   */
  cas(
    storage: MemoryStorage,
    id: string,
    expected: MemoryState,
    newState: MemoryState,
    persistFn?: (id: string, state: MemoryState) => void,
  ): boolean {
    const m = storage.memories.get(id);
    if (!m) return false;
    if (m.state !== expected) return false;

    if (!MemoryLifecycle.isValidTransition(m.state, newState)) return false;

    m.state = newState;

    if (persistFn) {
      try {
        persistFn(id, newState);
      } catch (e) {
        // 假阳性禁止原则：持久化失败回滚 state
        m.state = expected;
        throw e;
      }
    }

    return true;
  }

  /** archive: Active → Archived */
  archive(
    storage: MemoryStorage,
    id: string,
    persistFn?: (id: string, state: MemoryState) => void,
  ): boolean {
    return this.cas(storage, id, MemoryState.Active, MemoryState.Archived, persistFn);
  }

  /** freeze: 任意状态 → Frozen（Obliterated 除外） */
  freeze(
    storage: MemoryStorage,
    id: string,
    persistFn?: (id: string, state: MemoryState) => void,
  ): boolean {
    const m = storage.memories.get(id);
    if (!m) return false;
    return this.cas(storage, id, m.state, MemoryState.Frozen, persistFn);
  }

  /** obliterate: 任意状态 → Obliterated */
  obliterate(
    storage: MemoryStorage,
    id: string,
    persistFn?: (id: string, state: MemoryState) => void,
  ): boolean {
    const m = storage.memories.get(id);
    if (!m) return false;
    if (m.state === MemoryState.Obliterated) return true;

    if (!MemoryLifecycle.isValidTransition(m.state, MemoryState.Obliterated)) return false;

    const previousState = m.state;
    m.state = MemoryState.Obliterated;

    if (persistFn) {
      try {
        persistFn(id, MemoryState.Obliterated);
      } catch (e) {
        m.state = previousState;
        throw e;
      }
    }

    return true;
  }
}
