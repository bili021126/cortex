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
 * @moved-from @cortex/shared/src/skill-registry.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type SkillTemplate,
  type SerializedSkillRegistry,
  type Tag,
  type FeedbackEntry,
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

export class SkillRegistry {
  /** 按标签索引 */
  private _byTag: Map<string, SkillTemplate[]> = new Map();
  /** 按 id 索引 */
  private _byId: Map<string, SkillTemplate> = new Map();

  // ── 注册 / 注销 ─────────────────────────────────────

  /** 注册一个技能模板（有则覆盖） */
  register(template: SkillTemplate): void {
    // id 去重——新模板覆盖旧模板
    if (this._byId.has(template.id)) {
      this.unregister(template.id);
    }

    this._byId.set(template.id, template);

    // 按标签索引
    for (const tag of template.triggerTags) {
      const existing = this._byTag.get(tag) ?? [];
      existing.push(template);
      this._byTag.set(tag, existing);
    }
  }

  /**
   * 注销技能模板。
   * 收集待删除 key 到数组后再统一删除，不在 for-of 中修改 Map。
   */
  unregister(id: string): boolean {
    const tmpl = this._byId.get(id);
    if (!tmpl) return false;

    this._byId.delete(id);

    // 从标签索引中移除
    const tagsToDelete: string[] = [];
    for (const [tag, templates] of this._byTag) {
      const filtered = templates.filter((t) => t.id !== id);
      if (filtered.length === 0) {
        tagsToDelete.push(tag);
      } else {
        this._byTag.set(tag, filtered);
      }
    }
    for (const tag of tagsToDelete) {
      this._byTag.delete(tag);
    }

    return true;
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
      const templates = this._byTag.get(tag);
      if (templates) {
        for (const t of templates) {
          const status = deriveStatus(t.weight, t.feedbackHistory);
          if (status === "active" || status === "trial") {
            matched.set(t.id, t);
          }
        }
      }
    }
    // 按 weight 降序排列——权重高的更可信，排在前面
    return [...matched.values()].sort((a, b) => b.weight - a.weight);
  }

  /** 按 id 获取 */
  get(id: string): SkillTemplate | undefined {
    return this._byId.get(id);
  }

  /** 获取所有已注册技能 */
  getAll(): SkillTemplate[] {
    return [...this._byId.values()];
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
    return this._byId.size;
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
    const tmpl = this._byId.get(id);
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
    for (const [id, tmpl] of this._byId) {
      if (tmpl.weight === 0 && tmpl.feedbackHistory.length === 0) {
        if (now - tmpl.createdAt > maxAgeMs) {
          this.unregister(id);
          removed.push(id);
        }
      }
    }
    return removed;
  }

  // ── 批量操作 ────────────────────────────────────────

  /** 批量注册 */
  registerAll(templates: SkillTemplate[]): void {
    for (const tmpl of templates) {
      this.register(tmpl);
    }
  }

  /** 清空注册表 */
  clear(): void {
    this._byId.clear();
    this._byTag.clear();
  }

  // ── 持久化 ─────────────────────────────────────────

  toJSON(): SerializedSkillRegistry {
    const templates = [...this._byId.values()];
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
   * 保存注册表到 JSON 文件。
   *
   * @deprecated 自 v2.6 起，MemoryStore 是唯一持久化源。
   *             保留此方法仅用于测试和手动迁移。
   */
  saveJson(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = this.toJSON();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * 从 JSON 文件恢复注册表。
   *
   * @deprecated 自 v2.6 起，MemoryStore 是唯一持久化源。
   *             保留此方法仅用于测试和冷启动迁移兜底。
   */
  static loadJson(filePath: string): SkillRegistry {
    if (!fs.existsSync(filePath)) {
      return new SkillRegistry();
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as SerializedSkillRegistry;
    return SkillRegistry.fromJSON(data);
  }
}

