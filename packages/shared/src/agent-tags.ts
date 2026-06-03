// ============================================================
// @cortex/shared — Agent 标签域
//
// TAG_VOCABULARY + AGENT_TAGS —— Scheduler/TaskBoard 的标签匹配基础。
// 运行时可通过 setAgentRegistry() 从 cortex-agents.json 覆写。
// ============================================================

import { AgentType } from "./agent-enums.js";

/** 标签词汇表（封闭集合） */
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
  "contract",
  "direction",
] as const;

export type Tag = (typeof TAG_VOCABULARY)[number];

/**
 * 每个 Agent 类型对应的认领标签。
 *
 * @contract AGENT_TAGS 契约（久岐忍 P1-5：模块边界缺少显式契约化定义 -> 已闭合）
 *
 *   此表是 Scheduler._findMatchingAgent 的匹配基础。
 *   变更规则：
 *   - 新增 AgentType 时必须同步添加标签
 *   - 删除/重命名标签时需同步更新 TAG_VOCABULARY
 *   - 标签不得跨 Agent 共享语义矛盾的定义
 *   - 平局打破依赖匹配密度（matching / |tags|），标签少的 Agent 在窄标签匹配上
 *     天然优于标签多的 Agent——不要通过增加无关标签来"扩大匹配范围"
 */
export const AGENT_TAGS: Record<AgentType, readonly Tag[]> = {
  [AgentType.Meta]:      ["plan_review"],   // Meta
  [AgentType.Code]:      ["code", "implementation", "refactor", "test", "config"],  // Code
  [AgentType.Review]:    ["review", "audit"],  // Review
  [AgentType.Analysis]:  ["analysis", "research"],  // Analysis
  [AgentType.Ops]:       ["ops", "deploy", "test"],  // Ops
  [AgentType.Loop]:      ["loop", "pattern_scan", "skill_precipitate"],  // Loop
  [AgentType.DocGovern]: ["doc-govern", "audit", "plan_review", "doc_audit", "constitution_check", "constitution_propose"],
  [AgentType.Butler]:    [],  // Butler
  [AgentType.Inspector]: ["inspector", "inspect"],  // Inspector
  [AgentType.Browser]:   ["browser", "ui_verify"],  // Browser
  [AgentType.Fix]:       ["fix", "bugfix", "repair", "diagnose", "heal"],  // Fix
  // Core-2 预埋
  [AgentType.Api]:        ["api", "api_design", "api_integration", "endpoint", "review", "research", "analysis"],
  [AgentType.Data]:       ["data", "data_model", "migration", "storage", "schema", "review", "research", "analysis"],
  [AgentType.Strategist]: ["strategy", "contract"],  // Strategist
};

// ─── 运行时标签覆写表 ──────────────────────────────

let _runtimeTags: Record<string, readonly string[]> = { ...AGENT_TAGS as unknown as Record<string, readonly string[]> };

/** 获取 Agent 标签（优先运行时覆写，回退编译期常量） */
export function getAgentTags(): Record<string, readonly string[]> {
  return _runtimeTags;
}

/** 获取标签词汇表（封闭集合） */
export function getTagVocabulary(): readonly string[] {
  return TAG_VOCABULARY;
}

/** 注入运行时标签覆写 */
export function setAgentTags(tags: Record<string, readonly string[]>): void {
  _runtimeTags = { ...AGENT_TAGS as unknown as Record<string, readonly string[]>, ...tags };
}
