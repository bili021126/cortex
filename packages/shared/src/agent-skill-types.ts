// ============================================================
// @cortex/shared — 技能模板类型
//
// SkillTemplate / SkillRegistryData —— LoopAgent 技能提取
// 与 MetaAgent 技能匹配的共享类型。
// ============================================================

import type { AgentType } from "./agent-enums.js";
import type { Tag } from "./agent-tags.js";

/** 技能模板——LoopAgent 从已完成任务中提炼的可复用工作流 */
export interface SkillTemplate {
  /** 唯一标识 */
  id: string;
  /** 归属 Agent 类型 */
  agentType: AgentType;
  /** 人类可读名称 */
  name: string;
  /** 触发标签——MetaAgent 按标签匹配技能 */
  triggerTags: Tag[];
  /** 触发条件描述——什么情况下该用这个技能 */
  trigger: string;
  /** 步骤序列——按顺序执行 */
  steps: string[];
  /** 预期产出格式 */
  expectedOutput: string;
  /** 输出文件模板（可含 {agent-key} 等占位符） */
  outputFile?: string;
  /** 试用期状态 */
  status: "draft" | "trial" | "active" | "deprecated";
  /** 连续采纳次数（active 后自动清零） */
  adoptionCount: number;
  /** 连续拒绝次数（>=3 -> deprecated） */
  rejectionCount: number;
  /** 提炼者（LoopAgent） */
  discoveredBy: string;
  /** 创建时间 */
  createdAt: number;
  /** 标签命中计数（运行时动态追踪——哪个标签触发了匹配） */
  tagHits?: Record<string, number>;
}

/** 技能注册表数据形状——MetaAgent 规划时查询匹配的技能模板 */
export interface SkillRegistryData {
  /** 按标签索引的技能模板 */
  templates: Map<string, SkillTemplate[]>;
  /** 按 Agent 类型索引 */
  byAgent: Map<AgentType, SkillTemplate[]>;
}
