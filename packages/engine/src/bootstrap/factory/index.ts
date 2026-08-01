// @layer 规划-执行层
// ============================================================
// @cortex/engine 内部 Bootstrap 配置流水线 · 桶导出
//（包内模块，非独立包）
//
// factory 模块是 Cortex engine 的唯一配置读取入口。
// 唯一对外 API：bootstrap()。
// ============================================================

export { bootstrap } from "./bootstrap.js";

export type {
  AgentManifest,
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

export { loadAgentsConfig } from "./loaders/agents.loader.js";
export { loadCognitionConfig } from "./loaders/cognition.loader.js";
export { loadDocsConfig } from "./loaders/docs.loader.js";
