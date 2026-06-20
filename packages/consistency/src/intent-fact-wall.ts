import type { MemoryEntry, MemoryWriteInput, ReadMode } from "@cortex/shared";

/**
 * IntentFactWall —— 意图-事实隔离墙（P0-六层防御）。
 *
 * 核心职责：
 * 1. **写路径** (`ensureSubType`)：按 kind 自动推断 isFact 默认值
 * 2. **读路径** (`filterRead`)：CSA 执行检索时隔离 Intent 类记忆
 *
 * 设计原则：
 * - 意图/事实分离是架构级约束，不是模型提示词
 * - "说不清是意图还是事实的，按事实处理"——宁可漏标也不误标
 * - HCA 规划扫描不过滤——MetaAgent 需要全局视图（含半成品意图）
 *
 * @remarks
 * 两阶段提交（Pending→commit→Active）是生命周期管理机制，
 * 与意图/事实的认知分类正交。Pending 记忆既可以是 Fact（待落地的结论）
 * 也可以是 Intent（待执行的计划）。
 */
export class IntentFactWall {
  // ── 写路径：isFact 默认值注入 ────────────────────

  /**
   * 按 kind 自动推断 isFact 默认值。
   *
   * 规则：
   * - kind === "Intent" → isFact 默认 false
   * - 其他四种 (TaskLog/Insight/Skill/Governance) → isFact 默认 true
   * - 若调用方已显式设置 isFact，保留调用方的值（"说不清就按事实"）
   */
  ensureSubType(input: MemoryWriteInput): MemoryWriteInput {
    if (input.isFact !== undefined) return input; // 调用方已显式设置，尊重之

    return {
      ...input,
      isFact: input.kind !== "Intent",
    };
  }

  // ── 读路径：CSA 排除 Intent ─────────────────────

  /**
   * CSA 模式下过滤非事实记忆。
   *
   * 过滤条件（同时满足）：
   * 1. 非 Pending（两阶段未提交的不参与检索）
   * 2. semantic_state === "Active"
   * 3. isFact !== false（排除显式标记为非事实的 Intent 类记忆）
   *
   * HCA 模式不过滤——MetaAgent 需要全局视图。
   */
  filterRead(entries: MemoryEntry[], mode: ReadMode): MemoryEntry[] {
    if (mode === "HCA") return entries;

    return entries.filter((e) =>
      e._pending !== true &&
      e.semantic_state === "Active" &&
      e.isFact !== false
    );
  }

  // ── 监控 ─────────────────────────────────────────

  /**
   * 统计读路径过滤比例（用于监控日志）。
   */
  stats(entries: MemoryEntry[], filtered: MemoryEntry[]): { total: number; filtered: number; ratio: number } {
    const total = entries.length;
    const filteredCount = total - filtered.length;
    return { total, filtered: filteredCount, ratio: total > 0 ? filteredCount / total : 0 };
  }
}
