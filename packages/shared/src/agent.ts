// ============================================================
// @cortex/shared — Agent 类型域桶导出
//
// 从共享域拆分为 5 个子模块（2026.05.31 重构）：
//   - agent-enums.ts        AgentType / AgentStatus / AgentContext
//   - agent-tags.ts         TAG_VOCABULARY / AGENT_TAGS / 运行时覆写
//   - agent-permissions.ts  工具权限表 / resolveAgentPermissions
//   - agent-skill-types.ts  SkillTemplate / SkillRegistryData
//   - agent-protocols.ts    MemoryAware / Executable / Agent
//
// 所有子模块通过此桶统一导出，外部消费方无需感知拆分细节。
// ============================================================

// ── 枚举 ──
export { AgentType, AgentStatus, AgentContext } from "./agent-enums.js";

// ── 标签 ──
export {
  TAG_VOCABULARY,
  AGENT_TAGS,
  getAgentTags,
  getTagVocabulary,
  setAgentTags,
} from "./agent-tags.js";
export type { Tag } from "./agent-tags.js";

// ── 权限 ──
export {
  AGENT_TOOL_PERMISSIONS,
  resolveAgentPermissions,
  getAgentToolPermissions,
  setAgentToolPermissions,
} from "./agent-permissions.js";

// ── 技能类型 ──
export type { SkillTemplate, SkillRegistryData } from "./agent-skill-types.js";

// ── 能力协议 ──
export { type AgentConfig, type MemoryAware, type Executable, type Agent } from "./agent-protocols.js";

// ── 共享身份锚点 ─────────────────────────────────────────

/**
 * 共享身份锚点——所有 Agent 的 system prompt 公共前缀。
 * 注入到每个 Agent 的 system prompt 之前，确保跨 Agent 的
 * 身份一致性和基础行为约束。
 */
export const SHARED_IDENTITY_ANCHOR = `[系统指令] 你是 Cortex 工程助手的身份锚点。`;

// ── 运行时注册表整合注入 ─────────────────────────────────

import { setAgentTags } from "./agent-tags.js";
import { setAgentToolPermissions } from "./agent-permissions.js";

/**
 * 注入运行时 Agent 注册表覆写。
 * bootstrapEngine 在启动时调用，将 cortex-agents.json 中的
 * 自定义 tags 和 toolPermissions 注入到 shared 层运行时状态。
 */
export function setAgentRegistry(
  tags: Record<string, readonly string[]>,
  toolPermissions: Record<string, readonly string[]>,
  _allTags: string[],
): void {
  setAgentTags(tags);
  setAgentToolPermissions(toolPermissions);
}
