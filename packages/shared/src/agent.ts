// ============================================================
// @cortex/shared — Agent 类型域
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
  // Core-2 预埋
  Api       = "api",
  Browser   = "browser",
  Data      = "data",
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
  "inspector",
  "inspect",
  "doc-govern",
  "doc_govern",
  "browser",
  "ui_verify",
] as const;

export type Tag = (typeof TAG_VOCABULARY)[number];

/** 每个 Agent 类型对应的认领标签 */
export const AGENT_TAGS: Record<AgentType, readonly Tag[]> = {
  [AgentType.Meta]:      ["plan_review"],
  [AgentType.Code]:      ["code", "implementation", "bugfix", "refactor", "test", "config"],
  [AgentType.Review]:    ["review", "audit"],
  [AgentType.Analysis]:  ["analysis", "research"],
  [AgentType.Ops]:       ["ops", "deploy"],
  [AgentType.Loop]:      ["loop", "pattern_scan", "skill_precipitate"],
  [AgentType.DocGovern]: ["doc-govern", "doc_govern", "audit", "plan_review", "doc_audit", "constitution_check"],
  [AgentType.Butler]:    [],
  [AgentType.Inspector]: ["inspector", "inspect"],
  [AgentType.Browser]:   ["browser", "ui_verify"],
  // Core-2 预埋
  [AgentType.Api]:       [],
  [AgentType.Data]:      [],
};

// ─── Toolkit 集中权限表 ─────────────────────────────────────

/**
 * 安全区内 Agent 的完整工具权限集。
 * 安全由目录级沙箱（registerTools 时绑定工作区）兜底。
 */
const FULL_TOOLSET: readonly string[] = ["read_file", "write_file", "search_code", "run_shell", "list_files", "delete_file"];

/**
 * Agent 工具权限由 Toolkit 层集中校验，Agent 以身份调用，不持有权限定义。
 * 安全由目录级沙箱（registerTools 时绑定工作区）兜底，工具权限全部开放。
 */
export const AGENT_TOOL_PERMISSIONS: Record<AgentType, readonly string[]> = {
  // 规划者：只读工具
  [AgentType.Meta]:      ["read_file", "search_code", "list_files"],
  // 执行者：在安全工作区内拥有完整工具权限
  [AgentType.Code]:      FULL_TOOLSET,
  [AgentType.Review]:    FULL_TOOLSET,
  [AgentType.Analysis]:  FULL_TOOLSET,
  [AgentType.Ops]:       FULL_TOOLSET,
  [AgentType.Loop]:      FULL_TOOLSET,
  [AgentType.DocGovern]: FULL_TOOLSET,
  [AgentType.Inspector]: FULL_TOOLSET,
  [AgentType.Browser]:   [...FULL_TOOLSET, "browser_do"],
  // 管家：不调用工具
  [AgentType.Butler]:    [],
  // Core-2 预埋
  [AgentType.Api]:       [],
  [AgentType.Data]:      [],
};

// ─── Agent 接口（定义移至 infra.ts 以解耦 agent ↔ task 循环依赖） ───
// 请从 @cortex/shared 导入 Agent / AgentConfig
