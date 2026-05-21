import type { MemoryEntry, MemoryWriteInput } from "@cortex/shared";
import { MemorySubType } from "@cortex/shared";

/**
 * IntentFactWall —— 意图/事实过滤墙（P0-六层防御 读路径拦截层）。
 *
 * 位置：ConsistencyLayer 内部，在 MemoryStore.read() 之后、上下文增强之前介入。
 *
 * 职责：
 * - filterRead() —— CSA 模式下过滤 Intent 半成品记忆，防污染 Agent 决策
 * - ensureSubType() —— 写前强制标记 subType，无标记默认 Fact
 *
 * 设计原则（consistency-design.md §3.2）：
 * - HCA（MetaAgent 规划扫描）：不过滤，MetaAgent 需要全局视图（含半成品）
 * - CSA（Agent 执行检索）：默认排除 Intent——"想做的事"不能当成"做成的事"
 *
 * @since P0-六层防御
 */
export class IntentFactWall {
  /**
   * 读路径过滤：按 queryMode 决定是否排除 Intent 记忆。
   *
   * - hca：返回原列表（MetaAgent 需要全貌）
   * - csa：过滤 subType === Intent 的记忆（Agent 只应看到事实）
   *
   * @param entries 记忆列表
   * @param queryMode 注意力模式
   * @returns 过滤后的记忆列表
   */
  filterRead(entries: MemoryEntry[], queryMode: "hca" | "csa"): MemoryEntry[] {
    if (queryMode === "hca") return entries;
    return entries.filter((e) => e.subType !== MemorySubType.Intent);
  }

  /**
   * 写前保护：确保 MemoryWriteInput 具有 subType 标记。
   *
   * 若未显式指定 subType，默认标记为 Fact——
   * "说不清是意图还是事实的，按事实处理"（宁可漏标也不误标）。
   *
   * @param input 原始写入输入
   * @returns 补全 subType 后的写入输入（新对象，不修改原始）
   */
  ensureSubType(input: MemoryWriteInput): MemoryWriteInput {
    if (input.subType !== undefined) return input;
    return { ...input, subType: MemorySubType.Fact };
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
