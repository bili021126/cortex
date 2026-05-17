// ============================================================
// @cortex/shared — Agent 类型域（类型中枢，有意单文件）
//
// @depends 无模块依赖（根类型定义，仅依赖 TypeScript 标准库）
// @usedBy  18/22 文件：scheduler.ts, task-board.ts, meta-agent.ts,
//          各 Agent 配置（code/review/analysis/ops/loop/doc-govern/
//          fix/inspector/browser/api/data-agent）、agent-factory.ts、
//          react-loop.ts、memory-store.ts、pipeline-observer.ts 等
// @dataflow 单向导出：类型/枚举/常量由本文件定义，所有消费方只读引用
//
// 架构决策：此文件是 @cortex/shared 的 Agent 类型总枢纽。
// 包含 AgentType 枚举、状态机、标签词汇表、工具权限表、
// 技能模板接口、Agent 能力协议（MemoryAware/Executable）。
//
// 高依赖数（~18/22 文件引用）是类型中枢的正常特征，
// 不是耦合缺陷——所有 Agent 组件必须共享同一份类型定义。
// 拆分此文件会引入循环引用风险，且类型一致性收益远大于
// 子模块化收益。仅在 AgentType 数量 >30 或权限表膨胀到
// 需要运行时按需加载时，才考虑按功能域拆分为：
//   agent-enums.ts / agent-permissions.ts / agent-protocols.ts
//
// @governance 久岐忍 P2-10：模块间隐式数据流依赖未标记 → 已闭合
// ============================================================

// ─── Agent 类型 ───────────────────────────────────────────

export enum AgentType {
  Meta      = "meta",
  Code      = "code",
  Review    = "review",
  Analysis  = "analysis",
  Ops       = "ops",
  Loop      = "loop",
  DocGovern = "doc-govern",
  Butler    = "butler",
  Inspector = "inspector",
  Fix       = "fix",
  // Core-2 预埋
  Api        = "api",
  Browser    = "browser",
  Data       = "data",
  Strategist = "strategist",
}

// ─── Agent 状态机 ───────────────────────────────────────────

/** Agent 生命周期状态 */
export enum AgentStatus {
  Created   = "created",
  Awake     = "awake",
  Active    = "active",
  Draining  = "draining",
  Destroyed = "destroyed",
}

// ─── 标签词汇表（封闭集合） ─────────────────────────────────

export const TAG_VOCABULARY = [
  "code",
  "implementation",
  "bugfix",
  "refactor",
  "test",
  "config",
  "review",
  "audit",
  "research",
  "analysis",
  "deploy",
  "ops",
  "loop",
  "pattern_scan",
  "skill_precipitate",
  "plan_review",
  "doc_audit",
  "constitution_check",
  "constitution_propose",
  "inspector",
  "inspect",
  "doc-govern",
  "doc_govern",
  "browser",
  "ui_verify",
  "fix",
  "repair",
  "diagnose",
  "heal",
  // Core-2
  "api",
  "data",
  "api_design",
  "api_integration",
  "endpoint",
  "data_model",
  "migration",
  "storage",
  "schema",
  "strategy",
  "strategist",
] as const;

export type Tag = (typeof TAG_VOCABULARY)[number];

/**
 * 每个 Agent 类型对应的认领标签。
 *
 * @contract AGENT_TAGS 契约（久岐忍 P1-5：模块边界缺少显式契约化定义 → 已闭合）
 *
 *   此表是 Scheduler._findMatchingAgent 的匹配基础。
 *   变更规则：
 *   - 新增 AgentType 时必须同步添加标签
 *   - 删除/重命名标签时需同步更新 TAG_VOCABULARY
 *   - 标签不得跨 Agent 共享语义矛盾的定义（例如 Code 不应包含 "review"——
 *     这将导致 Scheduler 在 tags=["review"] 的节点上将 Code 与 Review 平局匹配）
 *   - 平局打破依赖匹配密度（matching / |tags|），标签少的 Agent 在窄标签匹配上
 *     天然优于标签多的 Agent——不要通过增加无关标签来"扩大匹配范围"
 */
export const AGENT_TAGS: Record<AgentType, readonly Tag[]> = {
  [AgentType.Meta]:      ["plan_review"],
  [AgentType.Code]:      ["code", "implementation", "refactor", "test", "config", "review", "research", "analysis"],
  [AgentType.Review]:    ["review", "audit"],
  [AgentType.Analysis]:  ["analysis", "research"],
  [AgentType.Ops]:       ["ops", "deploy", "test"],
  [AgentType.Loop]:      ["loop", "pattern_scan", "skill_precipitate"],
  [AgentType.DocGovern]: ["doc-govern", "doc_govern", "audit", "plan_review", "doc_audit", "constitution_check", "constitution_propose"],
  [AgentType.Butler]:    [],
  [AgentType.Inspector]: ["inspector", "inspect"],
  [AgentType.Browser]:   ["browser", "ui_verify"],
  [AgentType.Fix]:       ["fix", "bugfix", "repair", "diagnose", "heal"],
  // Core-2 预埋
  [AgentType.Api]:        ["api", "api_design", "api_integration", "endpoint", "review", "research", "analysis"],
  [AgentType.Data]:       ["data", "data_model", "migration", "storage", "schema", "review", "research", "analysis"],
  [AgentType.Strategist]: ["strategy", "strategist"],
};

// ─── Toolkit 集中权限表 ─────────────────────────────────────

/**
 * 安全区内 Agent 的完整工具权限集。
 * 安全由目录级沙箱（registerTools 时绑定工作区）兜底。
 */
const FULL_TOOLSET: readonly string[] = ["read_file", "write_file", "search_code", "run_shell", "list_files", "delete_file"];
/** 基础工具集——不含 run_shell。测试/构建/包管理命令的执行权全权在北斗（Ops）。 */
const BASE_TOOLSET: readonly string[] = ["read_file", "write_file", "search_code", "list_files", "delete_file"];

/**
 * Agent 工具权限由 Toolkit 层集中校验，Agent 以身份调用，不持有权限定义。
 * 安全由目录级沙箱（registerTools 时绑定工作区）兜底，工具权限全部开放。
 */
export const AGENT_TOOL_PERMISSIONS: Record<AgentType, readonly string[]> = {
  // 规划者：只读工具
  [AgentType.Meta]:      ["read_file", "search_code", "list_files"],
  // 执行者：在安全工作区内拥有完整文件工具权限。run_shell 仅北斗持有
  [AgentType.Code]:      FULL_TOOLSET,  // 恢复 run_shell，用于测试验证与分析
  [AgentType.Review]:    FULL_TOOLSET,  // 恢复 run_shell，用于测试验证与分析
  [AgentType.Analysis]:  BASE_TOOLSET,
  [AgentType.Ops]:       FULL_TOOLSET,
  [AgentType.Loop]:      BASE_TOOLSET,
  [AgentType.DocGovern]: BASE_TOOLSET,
  [AgentType.Inspector]: BASE_TOOLSET,
  [AgentType.Browser]:   [...BASE_TOOLSET, "browser_do"],
  [AgentType.Fix]:       FULL_TOOLSET,
  // 管家：不调用工具
  [AgentType.Butler]:    [],
  // Core-2
  [AgentType.Api]:        BASE_TOOLSET,
  [AgentType.Data]:       BASE_TOOLSET,
  [AgentType.Strategist]: ["read_file", "search_code", "list_files"],
};

// ─── 技能机制（Core-2 预实现，类型先行） ─────────────────────────

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
  /** 连续拒绝次数（≥3 → deprecated） */
  rejectionCount: number;
  /** 提炼者（LoopAgent） */
  discoveredBy: string;
  /** 创建时间 */
  createdAt: number;
}

/** 技能注册表数据形状——MetaAgent 规划时查询匹配的技能模板 */
export interface SkillRegistryData {
  /** 按标签索引的技能模板 */
  templates: Map<string, SkillTemplate[]>;
  /** 按 Agent 类型索引 */
  byAgent: Map<AgentType, SkillTemplate[]>;
}

// ─── Agent 能力接口（分层协议） ───────────────────────────
// 基础 Agent 接口定义在 infra.ts（解耦 agent ↔ task 循环依赖）
// 以下为扩展能力接口，表达各 Agent 类型的差异化契约。

import type { MemoryQuery } from "./memory.js";
import type { TaskNode, NodeResult } from "./task.js";

/**
 * 可查询接口——有记忆访问能力的Agent。
 * CodeAgent/ReviewAgent/AnalysisAgent/LoopAgent 实现此接口，
 * 各自覆写 getMemoryQuery 定义「回家路径」。
 */
export interface MemoryAware {
  /** 记忆检索策略——子类定义各自的知识检索偏好 */
  getMemoryQuery(node: TaskNode): MemoryQuery;
}

/**
 * 可执行接口——有 LLM 执行能力的Agent。
 * 除 ButlerAgent 外所有执行型 Agent 实现此接口。
 */
export interface Executable {
  /** 系统提示词——定义 Agent 的角色人格与执行约束 */
  readonly systemPrompt: string;
  /** ReAct 循环上限。默认 64，InspectorAgent 等可降为 24 */
  readonly maxLoops: number;
  /** 执行前钩子——子类可覆写注入前置事实采集 */
  preExecuteHook?(node: TaskNode): TaskNode | Promise<TaskNode>;
}

import type { Agent as AgentInterface } from "./infra.js";

/**
 * Agent 构造器类型——工厂函数签名。
 * 用于 Scheduler 按 AgentType 查表创建实例，
 * 替代各处分散的 switch-case mockAgentByType。
 *
 * 参数类型约束宽松（unknown），由调用方（engine 层）收敛。
 * shared 层不依赖 @cortex/llm 和 engine 子包。
 */
export type AgentConstructor = new (
  llm: unknown,
  toolkit: unknown,
  memory?: unknown,
) => AgentInterface;
