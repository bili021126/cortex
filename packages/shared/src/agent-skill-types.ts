// ============================================================
// @cortex/shared — 技能模板类型
//
// Skill = 结构化认知——Agent 产出的可参照方法论。
// 技能即记忆：一个 Agent 对另一个 Agent 说"我曾这样做成过"。
//
// 设计宪法：
//   - 技能是"被参照"而非"被执行"——执行权属于 Agent
//   - 状态是衍生标签（deriveStatus），而非状态机
//   - 可靠性来自评价累加（weight），而非二值判断
//   - 三层权限：莫娜持有池子 → MetaAgent 建议标签 → 执行Agent 自主拉取
//
// @since v2.6 — 技能系统重构：压扁重复实现，回归记忆本质
// ============================================================

import type { Tag } from "./agent-registry.js";

/** 经验种类——认知的三种形态 */
export type SkillKind = "action" | "thought" | "workflow";

/**
 * 技能模板——Agent 产出的结构化认知。
 *
 * 技能不是可执行函数，是经验沉淀。
 * 一个 FixAgent 修完 bug 后觉得"这个模式可以复用"→ 产出 action 经验。
 * 一个 AnalysisAgent 分析完后觉得"先画图再下结论"→ 产出 thought 经验。
 * 进池之后，后来者查阅、参考、评价——技能在回流中进化。
 */
export interface SkillTemplate {
  /** 唯一标识 */
  id: string;
  /** R12-F4：自增殖技能的 trial 状态——未经人工审核不注入 prompt */
  trial?: boolean;

  /** 经验种类：行动的、思考的、流程的 */
  kind: SkillKind;
  /** 人类可读名称 */
  name: string;
  /** 触发标签——MetaAgent 按标签匹配技能 */
  triggerTags: Tag[];
  /** 触发条件描述——什么情况下该参考这个经验 */
  trigger: string;
  /** 步骤序列——参考做法 */
  steps: string[];
  /** 预期产出格式 */
  expectedOutput: string;
  /** 输出文件模板（可含 {agent-key} 等占位符） */
  outputFile?: string;
  /** 状态——纯函数 deriveStatus(weight, feedbackCount) 计算 */
  status: "trial" | "active" | "deprecated";
  /** 累计权重——每次使用+评价回流时累加（替代 adoptionCount/rejectionCount 二值模型） */
  weight: number;
  /** 评价历史——谁用过、评分如何、有无建议 */
  feedbackHistory: FeedbackEntry[];
  /** 产出者标识 */
  discoveredBy: string;
  /** 创建时间 */
  createdAt: number;
  /** 标签命中计数（运行时动态追踪） */
  tagHits?: Record<string, number>;
  /** Core-2: 目标 Agent 类型——仅该类型 Agent 可见（L3 作用域过滤） */
  agentType?: string;
  /** Core-2: 是否可通过 / 命令被用户调用。默认 true（历史技能兼容） */
  userInvocable?: boolean;
  /** Core-2: 作用域层级——cross-domain | project | package（运行时标注，不持久化到 JSON） */
  _scope?: string;
  /** Core-2: 包级技能的所属包名（运行时标注） */
  _packageName?: string;
}

/** 评价回流条目——Agent 使用技能后带回的评价 */
export interface FeedbackEntry {
  /** 使用该技能的 Agent 标识 */
  agentId: string;
  /** 评分：1=有效，0=无效，-1=有害 */
  rating: number;
  /** 优化建议（可选） */
  suggestion?: string;
  /** 评价时间 */
  timestamp: number;
}


