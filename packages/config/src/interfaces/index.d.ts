/**
 * @cortex/config — 接口总桶导出
 *
 * 按职责域拆分的所有配置类型，统一从此处导出。
 *
 * @module interfaces/index
 * @layer root — 零依赖，纯类型层
 */
export type { EngineConfig, ToolTimeoutsConfig, InspectorConfig, LlmConfig, FilePathsConfig, SkillSystemConfig, } from "./engine.js";
export type { AgentDefinition, AgentDisplay, AgentRoundtable, AgentsConfig, } from "./agent.js";
export type { RouteTableEntry, RouteTableMap, CommitteeRule, EventRoutingConfig, } from "./event-routing.js";
export type { ToolParameterDef, ToolMeta, ToolRegistry, } from "./tool.js";
export type { RoundtableTemplate } from "./roundtable.js";
export type { SearchProviderConfig, SearchAggregationConfig, SearchConfig, McpTransport, McpServerEntry, McpServersConfig, OutputFormat, } from "./search.js";
export { OUTPUT_FORMATS } from "./search.js";
export type { SelfExaminationConfig } from "./self-examination.js";
export type { CrossVerificationPair, CrossVerificationConfig, } from "./cross-verification.js";
export type { SeedMemoryEntry, SeedMemoriesConfig, } from "./seed-memory.js";
export type { GovernancePipelineConfig } from "./governance.js";
export type { ActivationEntry, AttentionStrategy, CognitionConfig, } from "./cognition.js";
export type { DocType, DocEntry, DocsConfig, } from "./docs.js";
//# sourceMappingURL=index.d.ts.map