// ============================================================
// @cortex/factory — 桶导出
//
// factory 包是 Cortex 的唯一配置读取入口。
// 唯一对外 API：bootstrap()。
// ============================================================
export { bootstrap } from "./bootstrap.js";
export { validateCrossField } from "./schemas/cross-field.validator.js";
export { loadAgentsConfig } from "./loaders/agents.loader.js";
export { loadCognitionConfig } from "./loaders/cognition.loader.js";
export { loadDocsConfig } from "./loaders/docs.loader.js";
//# sourceMappingURL=index.js.map