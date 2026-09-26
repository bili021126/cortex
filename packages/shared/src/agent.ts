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

// ⚠️ 本桶被绕过，且下面这个常量包外不可达（2026-09-26 核实，**未修**）
//
//   · 本文件头部自述「所有子模块通过此桶统一导出，外部消费方无需感知拆分细节」，
//     但 `shared/src/index.ts` **从不引用 `./agent.js`**（grep 零命中）——它直接
//     从 `agent-registry.js` / `agent-skill-types.js` / `agent-protocols.js`
//     再导出，也就是本文件在做的事。所以这个桶的用途落空了。
//   · 全仓唯一 import `./agent.js` 的是 `modification-record.ts`（取 `AgentType`）。
//   · 因此本行这个常量**不在 `@cortex/shared` 的公开面上**——`index.ts` 没有转出它，
//     包外拿不到；包内除本文件外也无人引用。它是一句内嵌的中文提示词
//     （「你是 Cortex 工程助手的身份锚点」），与本文件其余部分（纯类型再导出）
//     性质不同，且在一份 barrel 里孤立存在。
// 详见 core-3-design-backlog.md N-28。未删——删它是代码改动，越出本轮边界。
export const SHARED_IDENTITY_ANCHOR = `[系统指令] 你是 Cortex 工程助手的身份锚点。`;
