/**
 * @cortex/config — 接口总桶导出
 *
 * 按职责域拆分的所有配置类型，统一从此处导出。
 *
 * @module interfaces/index
 * @layer root — 零依赖，纯类型层
 */

// ── 引擎 ──
export type {
  EngineConfig,
  ToolTimeoutsConfig,
  InspectorConfig,
  LlmConfig,
  FilePathsConfig,
  SkillSystemConfig,
} from "./engine.js";

// ── Agent ──
export type {
  AgentManifest,
  AgentDisplay,
  AgentRoundtable,
  AgentsConfig,
} from "./agent.js";

// ── Agent Manifest ──
export type {
  AgentProfile,
  AgentManifestDecl,
  AgentManifestConfig,
} from "./agent-manifest.js";

// ── 模型 ──
export type {
  ModelCapability,
  ModelEntry,
  ModelsConfig,
} from "./model.js";

// ── 密钥+上下文 ──
export type {
  KeyEntry,
  ContextLimitEntry,
  KeysContextConfig,
} from "./key-context.js";

// ── 调参 ──
export type {
  EnvVarEntry,
  ExecutionTuning,
  TrustTuning,
  VerificationTuning,
  MemoryTuning,
  RlmTuning,
  TuningParams,
  TuningConfig,
} from "./tuning.js";

// ── 事件路由 ──
export type {
  RouteTableEntry,
  RouteTableMap,
  CommitteeRule,
  EventRoutingConfig,
} from "./event-routing.js";

// ── 工具 ──
export type {
  ToolParameterDef,
  ToolMeta,
  ToolRegistry,
} from "./tool.js";

// ── 圆桌 ──
export type { RoundtableTemplate } from "./roundtable.js";

// ── 搜索 ──
export type {
  SearchProviderConfig,
  SearchAggregationConfig,
  SearchConfig,
  McpTransport,
  McpServerEntry,
  McpServersConfig,
  OutputFormat,
} from "./search.js";

export { OUTPUT_FORMATS } from "./search.js";

// ── 自审视 ──
export type { SelfExaminationConfig } from "./self-examination.js";

// ── 交叉验证 ──
export type {
  CrossVerificationPair,
  CrossVerificationConfig,
} from "./cross-verification.js";

// ── 种子记忆 ──
export type {
  SeedMemoryEntry,
  SeedMemoriesConfig,
} from "./seed-memory.js";

// ── 治理 ──
export type { GovernancePipelineConfig } from "./governance.js";

// ── 认知 ──
export type {
  ActivationEntry,
  AttentionStrategy,
  CognitionConfig,
} from "./cognition.js";

// ── 文档 ──
export type {
  DocType,
  DocEntry,
  DocsConfig,
} from "./docs.js";
