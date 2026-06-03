// ============================================================
// @cortex/shared — Agent 枚举域
//
// AgentType / AgentStatus / AgentContext —— 零依赖基础枚举。
// 所有 Agent 域的根节点。
// ============================================================

/** Agent 角色类型 */
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

/** Agent 生命周期状态 */
export enum AgentStatus {
  Created   = "created",
  Awake     = "awake",
  Active    = "active",
  Draining  = "draining",
  Destroyed = "destroyed",
}

/**
 * Agent 执行上下文枚举。
 *
 * 同一 AgentType 在不同上下文中可拥有不同的工具权限集。
 * 例如 ReviewAgent 在生产审查场景不允许 run_shell，
 * 但在自我检查（self_examination）场景需要执行测试验证。
 */
export enum AgentContext {
  /** 生产审查场景——默认值，最严格权限 */
  Production = "production",
  /** 自我检查场景——允许 Agent 执行测试/验证自身产出 */
  SelfExamination = "self_examination",
}
