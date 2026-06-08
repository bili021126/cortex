/**
 * @cortex/config — Agent 标签域
 *
 * TAG_VOCABULARY + AGENT_TAGS —— Scheduler/TaskBoard 的标签匹配基础。
 * 从 @cortex/shared 迁移至 config 实现单源管理。
 *
 * 运行时可通过 shared 层的 getAgentTags()/setAgentTags() 覆写，
 * 覆写数据可来自 cortex-agents.json 加载。
 *
 * @layer root
 * @since v2.5.41 标签域配置化
 */

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
 * 每个 Agent 类型对应的认领标签（string 键版本）。
 * 消费方（Scheduler）通过此表进行标签匹配。
 *
 * @contract AGENT_TAGS 契约
 *   此表是 Scheduler._findMatchingAgent 的匹配基础。
 *   变更规则：
 *   - 新增 AgentType 时必须同步添加标签
 *   - 删除/重命名标签时需同步更新 TAG_VOCABULARY
 *   - 标签不得跨 Agent 共享语义矛盾的定义
 */
export const AGENT_TAGS: Record<string, readonly Tag[]> = {
  Meta:      ["plan_review"],
  Code:      ["code", "implementation", "refactor", "test", "config"],
  Review:    ["review", "audit"],
  Analysis:  ["analysis", "research"],
  Ops:       ["ops", "deploy", "test"],
  Loop:      ["loop", "pattern_scan", "skill_precipitate"],
  DocGovern: ["doc-govern", "audit", "plan_review", "doc_audit", "constitution_check", "constitution_propose"],
  Butler:    [],
  Inspector: ["inspector", "inspect"],
  Browser:   ["browser", "ui_verify"],
  Fix:       ["fix", "bugfix", "repair", "diagnose", "heal"],
  // Core-2 预埋
  Api:        ["api", "api_design", "api_integration", "endpoint", "review", "research", "analysis"],
  Data:       ["data", "data_model", "migration", "storage", "schema", "review", "research", "analysis"],
  Strategist: ["strategy", "contract"],
};
