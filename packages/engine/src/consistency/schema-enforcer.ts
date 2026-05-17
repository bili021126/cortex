import type { MemoryWriteInput } from "@cortex/shared";
import { MemorySubType } from "@cortex/shared";

/**
 * SchemaEnforcer —— 记忆结构校验器（P1-六层防御）。
 *
 * Core-1 职责：
 * - validate()：校验 MemoryWriteInput 字段完整性
 * - annotate()：自动注入默认字段（subType 默认 Fact）
 *
 * 注意：MemoryWriteInput 不含 state 字段（state 由 MemoryStorage.insert() 内部设定）。
 *       约束检查聚焦于输入侧可见字段。
 *
 * modification-record 全量 Schema 延后至 Core-2。
 *
 * @since P1-六层防御
 */

// ─── 类型 ────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── 校验器 ──────────────────────────────────────

export class SchemaEnforcer {
  /**
   * 校验 MemoryWriteInput 结构完整性。
   *
   * 规则：
   * - memoryType 必须提供
   * - content 不能为 null/undefined
   * - summary 不能为空字符串
   * - agentType 必须提供（记忆来源必须可追溯）
   * - creatorId 必须提供
   */
  validate(input: MemoryWriteInput): ValidationResult {
    const errors: string[] = [];

    // R1: memoryType 必须提供
    if (input.memoryType === undefined || input.memoryType === null) {
      errors.push("memoryType is required");
    }

    // R2: content 不能为空
    if (input.content === undefined || input.content === null) {
      errors.push("content is required");
    }

    // R3: summary 不能为空字符串
    if (input.summary === undefined || input.summary === null || input.summary.trim() === "") {
      errors.push("summary is required and must not be empty");
    }

    // R4: agentType 追溯性
    if (input.agentType === undefined || input.agentType === null) {
      errors.push("agentType is required");
    }

    // R5: creatorId 追溯性
    if (input.creatorId === undefined || input.creatorId === null || input.creatorId.trim() === "") {
      errors.push("creatorId is required and must not be empty");
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 自动注入默认字段（P1 精简版）。
   *
   * 注入规则：
   * - subType 未提供 → 默认 Fact
   */
  annotate(input: MemoryWriteInput): MemoryWriteInput {
    const annotated = { ...input };

    // subType 默认值：未指定时默认为 Fact
    if (annotated.subType === undefined) {
      annotated.subType = MemorySubType.Fact;
    }

    return annotated;
  }
}
