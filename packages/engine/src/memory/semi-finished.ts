import type { MemoryEntry, MemoryWriteInput } from "@cortex/shared";
import { MemoryState, MemorySubType } from "@cortex/shared";
import type { MemoryStorage } from "./storage.js";
import type { MemoryLifecycle } from "./lifecycle.js";

/**
 * SemiFinishedMgr —— 记忆两阶段提交管理器（P0-六层防御）。
 *
 * 半成品防御：Agent 产出的记忆先进入 Pending 状态，
 * 经另一个 Agent（或系统自校验）验证后再 commit 为 Active。
 * Pending 记忆默认不参与检索——防半成品污染决策。
 *
 * 流程：
 *   1. Agent 产出 → writePending() → state=Pending, subType=Intent
 *   2. 验证通过   → commit()      → state=Active,  subType=Fact
 *   3. 验证失败   → 保持 Pending，可 archive/obliterate
 *
 * @since P0-六层防御
 */
export class SemiFinishedMgr {
  private _lifecycle: MemoryLifecycle;

  constructor(lifecycle: MemoryLifecycle) {
    this._lifecycle = lifecycle;
  }

  /**
   * 写入一条半成品记忆（Pending 状态）。
   * 调用方（通常是 Agent pipeline）产出但尚未被验证的记忆。
   *
   * @returns 生成的记忆 id；失败抛出异常。
   */
  writePending(
    storage: MemoryStorage,
    input: MemoryWriteInput,
    persistFn?: (id: string, state: MemoryState) => void,
  ): string {
    // 注入 Pending 状态和 Intent 子类型
    const pendingEntry = storage.insert({
      ...input,
      subType: input.subType ?? MemorySubType.Intent,
    });

    // 将默认 Active 覆盖为 Pending
    const m = storage.memories.get(pendingEntry.id);
    if (m) {
      m.state = MemoryState.Pending;
      if (persistFn) {
        try {
          persistFn(pendingEntry.id, MemoryState.Pending);
        } catch (e) {
          storage.delete(pendingEntry.id);
          throw e;
        }
      }
    }

    return pendingEntry.id;
  }

  /**
   * 提交半成品记忆：Pending → Active。
   * 同时将 subType 从 Intent 切换为 Fact（意图→事实）。
   *
   * @param subTypePersistFn 可选——subType 翻转后的持久化回调。
   *   调用方（MemoryStore.commitMemory）负责通过此回调将 subType 写入 SQLite。
   * @returns true 如果提交成功；false 如果状态不匹配或记忆不存在。
   */
  commit(
    storage: MemoryStorage,
    id: string,
    persistFn?: (id: string, state: MemoryState) => void,
    subTypePersistFn?: (id: string, subType: MemorySubType) => void,
  ): boolean {
    const ok = this._lifecycle.commit(storage, id, persistFn);
    if (ok) {
      // 提交成功：将 subType 从 Intent 翻转为 Fact
      const m = storage.memories.get(id);
      if (m && m.subType === MemorySubType.Intent) {
        m.subType = MemorySubType.Fact;
        if (subTypePersistFn) {
          try {
            subTypePersistFn(id, MemorySubType.Fact);
          } catch {
            // subType 持久化失败不阻塞主流程（state 已持久化成功）
          }
        }
      }
    }
    return ok;
  }

  /**
   * 回退半成品：Pending → Archived（放弃该半成品）。
   */
  discard(
    storage: MemoryStorage,
    id: string,
    persistFn?: (id: string, state: MemoryState) => void,
  ): boolean {
    return this._lifecycle.cas(storage, id, MemoryState.Pending, MemoryState.Archived, persistFn);
  }

  /**
   * 获取所有 Pending 状态的记忆（供验证方使用）。
   */
  getPending(storage: MemoryStorage): MemoryEntry[] {
    const results: MemoryEntry[] = [];
    for (const m of storage.memories.values()) {
      if (m.state === MemoryState.Pending) {
        results.push(m);
      }
    }
    return results;
  }

  /**
   * 检查是否存在 Pending 记忆（用于判断是否需要验证轮次）。
   */
  hasPending(storage: MemoryStorage): boolean {
    for (const m of storage.memories.values()) {
      if (m.state === MemoryState.Pending) return true;
    }
    return false;
  }
}
