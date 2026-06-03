// ============================================================
// @cortex/shared — Agent 工具权限表
//
// Toolkit.execute() 的集中授权依据。每个 AgentType 声明其允许的工具集。
// Agent 以身份调用，不持有权限定义；权限由 Toolkit 层按此表统一校验。
// ============================================================

import { AgentType, AgentContext } from "./agent-enums.js";

/** 安全区内 Agent 的完整工具权限集 */
const FULL_TOOLSET: readonly string[] = ["read_file", "write_file", "search_code", "web_search", "run_shell", "list_files", "delete_file", "parse_ast"];

/** 基础工具集——不含 run_shell */
const BASE_TOOLSET: readonly string[] = ["read_file", "write_file", "search_code", "web_search", "list_files", "delete_file", "parse_ast"];

/**
 * Agent 工具权限表。
 * 安全由目录级沙箱（registerTools 时绑定工作区）兜底。
 */
export const AGENT_TOOL_PERMISSIONS: Record<AgentType, readonly string[]> = {
  [AgentType.Meta]:      ["read_file", "search_code", "web_search", "list_files", "parse_ast"],
  [AgentType.Code]:      FULL_TOOLSET,
  [AgentType.Review]:    BASE_TOOLSET,
  [AgentType.Analysis]:  BASE_TOOLSET,
  [AgentType.Ops]:       FULL_TOOLSET,
  [AgentType.Loop]:      BASE_TOOLSET,
  [AgentType.DocGovern]: BASE_TOOLSET,
  [AgentType.Inspector]: BASE_TOOLSET,
  [AgentType.Browser]:   [...BASE_TOOLSET, "browser_do"],
  [AgentType.Fix]:       FULL_TOOLSET,
  [AgentType.Butler]:    ["web_search"],
  // Core-2
  [AgentType.Api]:        BASE_TOOLSET,
  [AgentType.Data]:       BASE_TOOLSET,
  [AgentType.Strategist]: ["read_file", "search_code", "web_search", "list_files", "parse_ast"],
};

/**
 * 按 AgentType + AgentContext 解析实际权限集。
 *
 * ReviewAgent 权限动态规则：
 *   - production（默认）→ BASE_TOOLSET（无 run_shell）
 *   - self_examination  → FULL_TOOLSET（含 run_shell，用于测试验证）
 *
 * 其他 Agent 类型当前不受 context 影响，直接返回默认权限。
 */
export function resolveAgentPermissions(
  agentType: AgentType,
  context: AgentContext = AgentContext.Production,
): readonly string[] {
  if (agentType === AgentType.Review) {
    return context === AgentContext.SelfExamination ? FULL_TOOLSET : BASE_TOOLSET;
  }
  return AGENT_TOOL_PERMISSIONS[agentType] ?? [];
}

// ─── 运行时权限覆写表 ──────────────────────────────

let _runtimeToolPermissions: Record<string, readonly string[]> = { ...AGENT_TOOL_PERMISSIONS as unknown as Record<string, readonly string[]> };

/** 获取 Agent 工具权限（优先运行时覆写，回退编译期常量） */
export function getAgentToolPermissions(): Record<string, readonly string[]> {
  return _runtimeToolPermissions;
}

/** 注入运行时权限覆写 */
export function setAgentToolPermissions(permissions: Record<string, readonly string[]>): void {
  _runtimeToolPermissions = { ...AGENT_TOOL_PERMISSIONS as unknown as Record<string, readonly string[]>, ...permissions };
}
