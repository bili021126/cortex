/**
 * skill-executor.ts —— 技能执行引擎。
 *
 * 与 SkillRegistry 构成完整的技能注册→匹配→执行闭环。
 * Core-1 阶段：技能步骤作为 prompt 注入，增强 Agent 执行上下文。
 * 后续阶段可扩展为直接 ToolGateway 调用。
 *
 * @since v2.5.25
 */

import { SkillRegistry } from "../registry/skill-registry.js";
import type { SkillTemplate, Tag } from "@cortex/shared";

// ─── SkillExecutor ──────────────────────────────────────────

export class SkillExecutor {
  private registry: SkillRegistry;
  private _onStatusChange?: (skill: SkillTemplate, oldStatus: string) => void;
  /** 临时缓存：skillId → 触发匹配的标签（供 recordFeedback 使用） */
  private _lastMatchTag = new Map<string, string>();

  constructor(registry: SkillRegistry, onStatusChange?: (skill: SkillTemplate, oldStatus: string) => void) {
    this.registry = registry;
    this._onStatusChange = onStatusChange;
  }

  /**
   * 根据标签匹配最佳技能。
   * 匹配规则：skill.triggerTags ∩ queryTags ≠ ∅
   * 排序：active > trial > draft，同状态按 adoptionCount 降序。
   *
   * @returns 最佳匹配的技能模板，无匹配返回 null。
   */
  matchSkill(tags: Tag[]): SkillTemplate | null {
    if (tags.length === 0) return null;

    const candidates = this.registry.queryByTags(tags);
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      // active 优先
      const statusOrder = { active: 0, trial: 1, draft: 2, deprecated: 3 };
      const aStatus = statusOrder[a.status] ?? 99;
      const bStatus = statusOrder[b.status] ?? 99;
      if (aStatus !== bStatus) return aStatus - bStatus;
      // 同状态按采纳数降序
      return b.adoptionCount - a.adoptionCount;
    });

    const best = candidates[0];

    // 记录触发匹配的标签（供 recordFeedback 更新 tagHits）
    const matchedTag = tags.find((t) => best.triggerTags.includes(t));
    if (matchedTag) {
      this._lastMatchTag.set(best.id, matchedTag);
    }

    return best;
  }

  /**
   * 按 ID 获取技能并生成执行上下文注入。
   *
   * @returns 格式化的 prompt 注入文本，供 Agent 的 system prompt 使用。
   *          技能不存在或已废弃时返回 null。
   */
  injectSkillContext(skillId: string): string | null {
    const skill = this.registry.get(skillId);
    if (!skill || skill.status === "deprecated") return null;
    return this._formatSkillPrompt(skill);
  }

  /**
   * 按标签匹配并注入技能上下文。
   * 组合 matchSkill + injectSkillContext。
   *
   * @returns 注入文本，无匹配返回 null。
   */
  injectByTags(tags: Tag[]): string | null {
    const skill = this.matchSkill(tags);
    if (!skill) return null;
    return this._formatSkillPrompt(skill);
  }

  /**
   * 验证技能模板完整性。
   * 检查必填字段、步骤非空、状态非废弃。
   *
   * @returns { valid: boolean, errors: string[] }
   */
  validate(skillId: string): { valid: boolean; errors: string[] } {
    const skill = this.registry.get(skillId);
    const errors: string[] = [];

    if (!skill) {
      errors.push(`技能 ${skillId} 不在注册表中`);
      return { valid: false, errors };
    }

    if (!skill.name) errors.push(`技能 ${skillId}: 缺少 name`);
    if (!skill.triggerTags || skill.triggerTags.length === 0) {
      errors.push(`技能 ${skillId}: 缺少 triggerTags`);
    }
    if (!skill.trigger) errors.push(`技能 ${skillId}: 缺少 trigger`);
    if (!skill.steps || skill.steps.length === 0) {
      errors.push(`技能 ${skillId}: 缺少 steps`);
    }
    if (skill.status === "deprecated") {
      errors.push(`技能 ${skillId}: 已废弃`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 记录技能采纳/拒绝反馈。
   * - 采纳：adoptionCount++，rejectionCount 清零。连续采纳 5 次 trial→active。
   * - 拒绝：rejectionCount++，adoptionCount 清零。连续拒绝 3 次 →deprecated。
   */
  recordFeedback(skillId: string, adopted: boolean): void {
    const skill = this.registry.get(skillId);
    if (!skill) return;

    const oldStatus = skill.status;

    if (adopted) {
      skill.adoptionCount++;
      skill.rejectionCount = 0;
      if (skill.adoptionCount >= 5 && skill.status === "trial") {
        skill.status = "active";
      }

      // 标签命中追踪：记录哪个标签触发了本次成功匹配
      const matchedTag = this._lastMatchTag.get(skillId);
      if (matchedTag) {
        if (!skill.tagHits) skill.tagHits = {};
        skill.tagHits[matchedTag] = (skill.tagHits[matchedTag] ?? 0) + 1;
        this._lastMatchTag.delete(skillId);

        // 幽灵标签检测：匹配标签不在 triggerTags 中时自动添加
        if (!skill.triggerTags.includes(matchedTag as Tag)) {
          skill.triggerTags.push(matchedTag as Tag);
        }
      }
    } else {
      skill.rejectionCount++;
      skill.adoptionCount = 0;
      if (skill.rejectionCount >= 3) {
        skill.status = "deprecated";
      }
      // 失败时清理匹配标签缓存
      this._lastMatchTag.delete(skillId);
    }

    // 状态变更时触发持久化回调（MemoryStore + JSON 文件双写）
    if (skill.status !== oldStatus && this._onStatusChange) {
      this._onStatusChange(skill, oldStatus);
    }
  }

  /**
   * 获取技能标签健康度诊断。
   * 检测幽灵标签（在 triggerTags 中但从未被命中）和缺失标签（频繁命中但不在 triggerTags 中）。
   * @returns 诊断信息数组，空数组表示标签健康。
   */
  diagnoseGhostTags(skillId: string): string[] {
    const skill = this.registry.get(skillId);
    if (!skill) return [`技能 ${skillId} 不存在`];

    const diagnostics: string[] = [];
    const hits = skill.tagHits ?? {};
    const totalHits = Object.values(hits).reduce((sum, v) => sum + v, 0);

    // 幽灵标签：在 triggerTags 中但从未被命中（且总命中次数足够多时）
    if (totalHits >= 5) {
      for (const tag of skill.triggerTags) {
        if (!(tag in hits) || (hits[tag] ?? 0) === 0) {
          diagnostics.push(
            `幽灵标签: "${tag}" 在 triggerTags 中但从未命中（总命中 ${totalHits} 次）。建议移除。`,
          );
        }
      }
    }

    return diagnostics;
  }

  /** 获取注册表中可用技能数量 */
  get availableCount(): number {
    return this.registry.activeCount;
  }

  /** 获取注册表引用（供测试诊断用） */
  get registryRef(): SkillRegistry {
    return this.registry;
  }

  // ── 私有方法 ───────────────────────────────────────────

  /**
   * 将 SkillTemplate 格式化为可注入 Agent system prompt 的文本块。
   */
  private _formatSkillPrompt(skill: SkillTemplate): string {
    const steps = skill.steps
      .map((s, i) => `  ${i + 1}. ${s}`)
      .join("\n");

    const statusLabel =
      skill.status === "active" ? "已验证" : "试用期";

    return `[技能注入: ${skill.name}]
触发条件: ${skill.trigger}
执行步骤:
${steps}
预期产出: ${skill.expectedOutput || "完成上述步骤"}
技能状态: ${statusLabel}
---`;
  }
}
