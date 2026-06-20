import type { MemoryWriteInput } from "@cortex/shared";

/**
 * SchemaEnforcer —— 记忆结构校验器（P1-六层防御）。
 *
 * Core-1 职责：
 * - validate()：校验 MemoryWriteInput 字段完整性
 * - annotate()：v3 已无 subType/默认注入需求，退化为透传
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

const REGEX_TIMEOUT_MS = 1000;

function safeRegexTest(re: RegExp, input: string): boolean {
  return new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("regex timeout")), REGEX_TIMEOUT_MS);
    try { resolve(re.test(input)); } catch(e) { reject(e); } finally { clearTimeout(timer); }
  }) as any;
}

export class SchemaEnforcer {
  /**
   * 校验 MemoryWriteInput 结构完整性（v3 字段）。
   *
   * 规则：
   * - kind 必须提供
   * - content_blob 不能为 null/undefined
   * - summary 不能为空字符串
   * - source.agentType 必须提供（记忆来源必须可追溯）
   */
  validate(input: MemoryWriteInput): ValidationResult {
    const errors: string[] = [];

    // R1: kind 必须提供
    if (input.kind === undefined || input.kind === null) {
      errors.push("kind is required");
    }

    // R2: content_blob 不能为空
    if (input.content_blob === undefined || input.content_blob === null) {
      errors.push("content_blob is required");
    }

    // R3: summary 不能为空字符串
    if (input.summary === undefined || input.summary === null || input.summary.trim() === "") {
      errors.push("summary is required and must not be empty");
    }

    // R4: source.agentType 追溯性
    if (input.source?.agentType === undefined || input.source?.agentType === null) {
      errors.push("source.agentType is required");
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * v3 透传——subType 已移除，无默认注入需求。
   */
  annotate(input: MemoryWriteInput): MemoryWriteInput {
    return input;
  }
}
