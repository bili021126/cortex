// ============================================================
// @cortex/shared — Agent 类型域桶导出
//
// 从共享域拆分为 4 个子模块（2026.05.31 重构）：
//   - agent-enums.ts        AgentType / AgentStatus / AgentContext
//   - agent-registry.ts     标签 / 展示 / 权限 / 运行时覆写（统一注册表）
//   - agent-skill-types.ts  SkillTemplate / SkillKind / FeedbackEntry
//   - agent-protocols.ts    MemoryAware / Executable / Agent
//
// 所有子模块通过此桶统一导出，外部消费方无需感知拆分细节。
// ============================================================

// ── 枚举（从 @cortex/config 迁回导出）──
export { AgentType, AgentStatus, AgentContext } from "./agent-enums.js";

// ── 注册表（标签 + 展示 + 权限 + 运行时覆写） ──
export {
  TAG_VOCABULARY,
  AGENT_TAGS,
  getAgentTags,
  getTagVocabulary,
  setAgentTags,
  AGENT_CHINESE_ROLE,
  CHINESE_NAME_TO_TYPE,
  AGENT_TOOL_PERMISSIONS,
  resolveAgentPermissions,
  getAgentToolPermissions,
  setAgentToolPermissions,
  AGENT_DISPLAY,
  AGENT_DISPLAY_BY_TYPE,
  AGENT_DISPLAY_FALLBACK,
  CHAT_AGENT_ALIASES,
  buildChineseRoleMap,
  setAgentRegistry,
} from "./agent-registry.js";
export type { Tag, AgentDisplayInfo, AgentDisplayEntry, AgentDefinition } from "./agent-registry.js";

// ── 技能类型 ──
export type { SkillTemplate, SkillKind, FeedbackEntry } from "./agent-skill-types.js";

// ── 能力协议 ──
export { type AgentConfig, type MemoryAware, type Executable, type Agent, type AgentCapability } from "./agent-protocols.js";

export const SHARED_IDENTITY_ANCHOR = `[系统指令] 你是 Cortex 工程助手的身份锚点。`;
