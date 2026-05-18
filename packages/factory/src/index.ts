// ============================================================
// @cortex/factory — 桶导出
//
// factory 包是 Cortex 的唯一配置读取入口。
// 唯一对外 API：bootstrap()。
// ============================================================

export { bootstrap } from "./bootstrap.js";

export type {
  AgentDefinition,
  EventRoutingConfig,
  CommitteeRule,
  RoundtableTemplate,
  CortexAgentsConfig,
  CortexCognitionConfig,
  CortexDocsConfig,
  BootstrapResult,
} from "./types.js";

export type { CrossFieldValidationResult } from "./schemas/cross-field.validator.js";
export { validateCrossField } from "./schemas/cross-field.validator.js";

export type { AgentAssemblyResult } from "./assemblers/agent.assembler.js";
export { assembleAgents } from "./assemblers/agent.assembler.js";

export type { AssembledEventRouter } from "./assemblers/event-router.assembler.js";
export { assembleEventRouter } from "./assemblers/event-router.assembler.js";

export type { AssembledCommittee } from "./assemblers/committee.assembler.js";
export { assembleCommittee } from "./assemblers/committee.assembler.js";

export type { TelescopeConfig } from "./assemblers/telescope.assembler.js";
export { assembleTelescope } from "./assemblers/telescope.assembler.js";

export { loadAgentsConfig } from "./loaders/agents.loader.js";
export { loadCognitionConfig } from "./loaders/cognition.loader.js";
export { loadDocsConfig } from "./loaders/docs.loader.js";
