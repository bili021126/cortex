/**
 * SkillRegistry —— 莫娜技能池。
 *
 * 技能不是可执行函数，是 Agent 产出的结构化认知。
 * 技能即记忆：一个 Agent 对另一个 Agent 说"我曾这样做成过"。
 *
 * 设计宪法：
 *   - 技能是"被参照"而非"被执行"——执行权属于 Agent
 *   - 状态是衍生标签（deriveStatus），而非状态机
 *   - 可靠性来自评价累加（weight + feedbackHistory），而非二值判断
 *   - 三层权限：莫娜持有池子 → MetaAgent 建议标签 → 执行Agent 自主拉取
 *
 * 双路径入池：
 *   内生——Agent 产出 → Pipeline 事件 → 注册（trial, weight=0）
 *   外源——skills/*.json → Schema 校验 → 注册（trial, weight=0）
 *
 * 生命周期闭环：
 *   生产→注册→MetaAgent 建议→执行Agent 拉取→使用→评价回流→更新
 *
 * @since v2.6 — 技能系统重构：压扁两套 Registry，回归记忆本质
 * @since v2.7 — 横向解耦：从 @cortex/engine 迁入 @cortex/skill-kit
 * @moved-from @cortex/engine/src/registry/skill-registry.ts
 */

import {
  type SkillTemplate,
  type SerializedSkillRegistry,
  type Tag,
  type FeedbackEntry,
  IndexedRegistry,
  type IndexDefinition,
} from "@cortex/shared";

// ─── 纯函数：状态推导 ───────────────────────────────────────

/**
 * 从 weight 和评价次数推导状态标签。
 * 这不是状态机——是纯函数的标签化显示。
 *
 *   - trial:   weight <= 0 或尚无正向评价
 *   - active:  weight >= 1 且有至少一次正向评价
 *   - deprecated: 连续 3+ 条 rating=-1
 */
export function deriveStatus(
  weight: number,
  feedbackHistory: FeedbackEntry[],
): "trial" | "active" | "deprecated" {
  // ⛑️ 兼容旧数据：feedbackHistory 可能为 undefined（v2.5 遗留或旧 toJSON 反序列化）
  const history = feedbackHistory ?? [];
  // 连续有害判定
  let consecutiveNegative = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].rating === -1) {
      consecutiveNegative++;
    } else {
      break;
    }
  }
  if (consecutiveNegative >= 3) return "deprecated";

  if (weight >= 1 && history.some((f) => f.rating === 1)) {
    return "active";
  }

  return "trial";
}

// ─── 注册表实现 ─────────────────────────────────────────

export class SkillRegistry extends IndexedRegistry<SkillTemplate> {
  // ── 索引定义 ─────────────────────────────────────

  protected defineIndexes(): IndexDefinition<SkillTemplate>[] {
    return [
      { name: "tag", extractKey: (s) => s.triggerTags },
    ];
  }

  // ── 查询 ────────────────────────────────────────────

  /**
   * 按标签查询匹配的技能模板。
   * 匹配规则：template.triggerTags ∩ queryTags ≠ ∅
   * 仅返回 trial 或 active 状态的模板。
   */
  queryByTags(queryTags: Tag[]): SkillTemplate[] {
    const matched = new Map<string, SkillTemplate>();
    for (const tag of queryTags) {
      for (const t of this.queryByIndex("tag", tag)) {
        const status = deriveStatus(t.weight, t.feedbackHistory);
        if (status === "active" || status === "trial") {
          matched.set(t.id, t);
        }
      }
    }
    // 按 weight 降序排列——权重高的更可信，排在前面
    return [...matched.values()].sort((a, b) => b.weight - a.weight);
  }

  /** 获取活跃技能数 */
  get activeCount(): number {
    return this.getAll().filter((t) => {
      const s = deriveStatus(t.weight, t.feedbackHistory);
      return s === "active" || s === "trial";
    }).length;
  }

  /** 获取总数 */
  get totalCount(): number {
    return this.items.size;
  }

  // ── 评价回流 ────────────────────────────────────────

  /**
   * Agent 使用技能后，带回评价。
   * weight 累加，feedbackHistory 追加。
   * 这是技能闭环的核心——评价驱动进化。
   */
  recordFeedback(
    id: string,
    agentId: string,
    rating: number,
    suggestion?: string,
  ): boolean {
    const tmpl = this.items.get(id);
    if (!tmpl) return false;

    tmpl.weight += rating; // rating: 1=有效, 0=无感, -1=有害
    tmpl.feedbackHistory.push({
      agentId,
      rating,
      suggestion,
      timestamp: Date.now(),
    });

    // 评价后重新计算状态
    tmpl.status = deriveStatus(tmpl.weight, tmpl.feedbackHistory);

    return true;
  }

  // ── 孤技能清理 ──────────────────────────────────────

  /**
   * 清理孤技能——weight=0 且创建超过 maxAgeMs 毫秒未被领取的技能。
   * 返回被清理的技能 id 列表。
   */
  cleanupOrphans(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): string[] {
    const now = Date.now();
    const removed: string[] = [];
    for (const [id, tmpl] of this.items) {
      if (tmpl.weight === 0 && tmpl.feedbackHistory.length === 0) {
        if (now - tmpl.createdAt > maxAgeMs) {
          this.unregister(id);
          removed.push(id);
        }
      }
    }
    return removed;
  }

  // ── 持久化 ─────────────────────────────────────────

  toJSON(): SerializedSkillRegistry {
    const templates = [...this.items.values()];
    return { version: 2, templates };
  }

  static fromJSON(data: SerializedSkillRegistry): SkillRegistry {
    const registry = new SkillRegistry();
    for (const tmpl of data.templates) {
      registry.register(tmpl);
    }
    return registry;
  }

  /**
   * 序列化为 JSON 字符串。
   */
  toJSONString(): string {
    return JSON.stringify(this.toJSON(), null, 2);
  }
}

