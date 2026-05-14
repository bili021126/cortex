/**
 * 技能注册表——完整版。
 *
 * MetaAgent 规划时查询匹配的技能模板。
 * LoopAgent 从已完成任务中提炼可复用工作流，写入注册表。
 *
 * 支持 JSON 序列化/反序列化持久化。
 * Core-2 完整 SkillExecutor（步骤执行引擎 + 反馈闭环）预留。
 *
 * @fix C5 — unregister 收集待删除 key 到数组后再统一删除，不在 for-of 中修改 Map。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType } from "./agent.js";
import type { SkillTemplate, Tag } from "./agent.js";

// ─── 注册表实现 ─────────────────────────────────────────

export class SkillRegistry {
  /** 按标签索引 */
  private _byTag: Map<string, SkillTemplate[]> = new Map();
  /** 按 Agent 类型索引 */
  private _byAgent: Map<AgentType, SkillTemplate[]> = new Map();
  /** 按时 id 索引 */
  private _byId: Map<string, SkillTemplate> = new Map();

  /** 注册一个技能模板 */
  register(template: SkillTemplate): void {
    // id 去重
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

    // 按 Agent 类型索引
    const byAgent = this._byAgent.get(template.agentType) ?? [];
    byAgent.push(template);
    this._byAgent.set(template.agentType, byAgent);
  }

  /**
   * 注销技能模板。
   * C5: 收集待删除的 key 到数组，遍历完后统一删除，不在 for-of 中修改 Map。
   */
  unregister(id: string): boolean {
    const tmpl = this._byId.get(id);
    if (!tmpl) return false;

    this._byId.delete(id);

    // 从标签索引中移除（C5: 收集待删除 key）
    const tagsToDelete: string[] = [];
    for (const [tag, templates] of this._byTag) {
      const filtered = templates.filter((t) => t.id !== id);
      if (filtered.length === 0) {
        tagsToDelete.push(tag);
      } else {
        this._byTag.set(tag, filtered);
      }
    }
    // 统一删除空标签
    for (const tag of tagsToDelete) {
      this._byTag.delete(tag);
    }

    // 从 Agent 类型索引中移除
    const byAgent = this._byAgent.get(tmpl.agentType);
    if (byAgent) {
      const filtered = byAgent.filter((t) => t.id !== id);
      if (filtered.length === 0) {
        this._byAgent.delete(tmpl.agentType);
      } else {
        this._byAgent.set(tmpl.agentType, filtered);
      }
    }

    return true;
  }

  /**
   * 按标签查询匹配的技能模板。
   * 匹配规则：template.triggerTags ∩ queryTags ≠ ∅
   * 仅返回 status === "active" 或 "trial" 的模板。
   */
  queryByTags(queryTags: Tag[]): SkillTemplate[] {
    const matched = new Map<string, SkillTemplate>();
    for (const tag of queryTags) {
      const templates = this._byTag.get(tag);
      if (templates) {
        for (const t of templates) {
          if (t.status === "active" || t.status === "trial") {
            matched.set(t.id, t);
          }
        }
      }
    }
    return [...matched.values()];
  }

  /** 按 Agent 类型查询 */
  queryByAgent(agentType: AgentType): SkillTemplate[] {
    return (this._byAgent.get(agentType) ?? []).filter(
      (t) => t.status === "active" || t.status === "trial"
    );
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
    return this.getAll().filter(
      (t) => t.status === "active" || t.status === "trial"
    ).length;
  }

  /** 获取总数 */
  get totalCount(): number {
    return this._byId.size;
  }

  /** 清空注册表 */
  clear(): void {
    this._byId.clear();
    this._byTag.clear();
    this._byAgent.clear();
  }

  // ── 持久化 ─────────────────────────────────────────

  /**
   * 导出为可序列化的纯数据。
   * Maps 转为 JSON 数组，供 saveJson / MemoryStore 使用。
   */
  toJSON(): SerializedSkillRegistry {
    const templates = [...this._byId.values()];
    return { version: 1, templates };
  }

  /**
   * 从纯数据恢复注册表。
   * 先清空当前数据再加载，确保一致性。
   */
  static fromJSON(data: SerializedSkillRegistry): SkillRegistry {
    const registry = new SkillRegistry();
    for (const tmpl of data.templates) {
      registry.register(tmpl);
    }
    return registry;
  }

  /**
   * 保存注册表到 JSON 文件。
   * 目录不存在时自动创建。
   */
  saveJson(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = this.toJSON();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * 从 JSON 文件恢复注册表。
   * 文件不存在时返回空注册表。
   */
  static loadJson(filePath: string): SkillRegistry {
    if (!fs.existsSync(filePath)) {
      return new SkillRegistry();
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as SerializedSkillRegistry;
    return SkillRegistry.fromJSON(data);
  }

  /**
   * 批量注册技能模板。
   * 用于从 MemoryStore 的 Skill 类型记忆中批量加载。
   */
  registerAll(templates: SkillTemplate[]): void {
    for (const tmpl of templates) {
      this.register(tmpl);
    }
  }
}

/** 技能注册表序列化形状 */
export interface SerializedSkillRegistry {
  version: number;
  templates: SkillTemplate[];
}
