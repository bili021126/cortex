import type { MemoryEntry, MemoryWriteInput, ReadMode } from "@cortex/shared";

/**
 * IntentFactWall —— v3 简化版。
 * subType 已在 v3 移除，Intent/Fact 区分由 Pending 两阶段提交通用处理。
 * filterRead 仅区分 HCA(不过滤)/CSA(按语义态过滤 Active)。
 */
export class IntentFactWall {
  filterRead(entries: MemoryEntry[], mode: ReadMode): MemoryEntry[] {
    // HCA: 广度浅读，返回全部（含 Pending 内部标记的记忆）
    if (mode === "HCA") return entries;
    // CSA: 仅返回语义态 Active 的记忆
    return entries.filter((e) => e._pending !== true && e.semantic_state === "Active");
  }

  /** v3: subType 已移除，此方法为 no-op 兼容保留 */
  ensureSubType(input: MemoryWriteInput): MemoryWriteInput {
    return input;
  }

  /**
   * 统计读路径过滤比例（用于监控日志）。
   */
  stats(entries: MemoryEntry[], filtered: MemoryEntry[]): { total: number; filtered: number; ratio: number } {
    const total = entries.length;
    const filteredCount = total - filtered.length;
    return { total, filtered: filteredCount, ratio: total > 0 ? filteredCount / total : 0 };
  }
}
