/**
 * @cortex/config — 统一配置包桶导出
 *
 * 结构：
 *   interfaces/   — 按职责域拆分的配置类型（纯接口）
 *   constants/    — 字符串/数字常量（按类别拆分）
 *   defaults      — 默认值对象 + resolveConfig 合并函数
 *   loader        — 可插拔 JSON 配置加载器（域注册 + 按需加载）
 *   data/         — JSON 配置文件（按职责域独立文件）
 *
 * @layer root — 零依赖，全局唯一真相源
 */

// ── 接口（全量） ──────────────────────────────────
export type {
  // 引擎
  EngineConfig,
  ToolTimeoutsConfig,
  InspectorConfig,
  LlmConfig,
  FilePathsConfig,
  SkillSystemConfig,
  // Agent
  AgentManifest,
  AgentDisplay,
  AgentRoundtable,
  AgentsConfig,
  // Agent Manifest
  AgentProfile,
  AgentManifestConfig,
  // 模型
  ModelCapability,
  ModelEntry,
  ModelsConfig,
  // 密钥+上下文
  KeyEntry,
  ContextLimitEntry,
  KeysContextConfig,
  // 调参
  EnvVarEntry,
  ExecutionTuning,
  TrustTuning,
  VerificationTuning,
  MemoryTuning,
  RlmTuning,
  TuningParams,
  TuningConfig,
  // 事件路由
  RouteTableEntry,
  RouteTableMap,
  CommitteeRule,
  EventRoutingConfig,
  // 工具
  ToolParameterDef,
  ToolMeta,
  ToolRegistry,
  // 圆桌
  RoundtableTemplate,
  // 搜索
  SearchProviderConfig,
  SearchAggregationConfig,
  SearchConfig,
  McpTransport,
  McpServerEntry,
  McpServersConfig,
  OutputFormat,
  // 自审视
  SelfExaminationConfig,
  // 交叉验证
  CrossVerificationPair,
  CrossVerificationConfig,
  // 种子记忆
  SeedMemoryEntry,
  SeedMemoriesConfig,
  // 治理
  GovernancePipelineConfig,
  // 认知
  ActivationEntry,
  AttentionStrategy,
  CognitionConfig,
  // 文档
  DocType,
  DocEntry,
  DocsConfig,
} from "./interfaces/index.js";

export { OUTPUT_FORMATS } from "./interfaces/index.js";

// ── 常量（全量） ──────────────────────────────────
export {
  CORTEX_VERSION,
  CORTEX_PHASE,
  DEPENDENCY_VERSIONS,
  DEFAULT_AGENT_QUOTA,
  DEFAULT_TASK_TIMEOUT_SEC,
  DEFAULT_COMMAND_TIMEOUT_SEC,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_MAX_TOOL_ROUNDS,
  TOOL_EXECUTION_TIMEOUT_MS,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_CHAT_MODEL,
  DEFAULT_LLM_REASONER_MODEL,
  DEFAULT_CLI_CHAT_MODEL,
  DEFAULT_LLM_FALLBACK_MODEL,
  ENV_DEEPSEEK_CYRENE_API_KEY,
  ENV_DEEPSEEK_GANYU_API_KEY,
  ENV_DEEPSEEK_CHAT_API_KEY,
  ENV_DEEPSEEK_REASONER_API_KEY,
  ENV_DEEPSEEK_API_KEY,
  ENV_DEEPSEEK_BASE_URL,
  ENV_DEEPSEEK_CHAT_MODEL,
  ENV_DEEPSEEK_CYRENE_CHAT_MODEL,
  ENV_DEEPSEEK_GANYU_CHAT_MODEL,
  ENV_DEEPSEEK_REASONER_MODEL,
  ENV_DEEPSEEK_REASONING_EFFORT,
  ENV_CORTEX_API_AUDIT,
  ENV_CORTEX_NO_SEARCH,
  ENV_PM_MASTER_KEY,
  ENV_CONFIRM_GATE_TIMEOUT_MS,
  ENV_VITEST,
  ENV_NODE_ENV,
  ENV_AUTO_CONFIRM,
  ENV_MAX_TOOL_ROUNDS,
  ENV_CORTEX_DEBUG,
  ENV_REACT_DEBUG,
  ENV_CORTEX_ROOT,
  ENV_CORTEX_ENABLE_CLI,
  withAutoConfirm,
  FILE_PERSONA_TALK_TXT,
  DIR_CONSTITUTION,
  DIR_AMENDMENTS,
  FILE_REPL_HISTORY,
  DIR_CORTEX,
  FILE_CYRENE_MEMORY_DB,
  FILE_SKILL_REGISTRY_JSON,
  FILE_CODING_STANDARDS,
  FILE_ENGINE_DB,
  DIR_GLOBAL_CONFIG,
  FILE_LOCAL_CONFIG,
  FILE_DOTENV,
  DIR_PROMPTS,
  FILE_TIMEOUT_COUNTERS,
  FILE_HASH_CACHE,
  DEFAULT_SKILL_TIMEOUT_MS,
  DEFAULT_SKILL_MAX_RETRIES,
  DEFAULT_AMENDMENT_TIMEOUT,
  RLM_MIN_CONFIDENCE,
  RLM_MAX_DEPTH,
  RLM_MIN_COMPLEXITY_CHARS,
  DENSITY_LIGHT_MAX_CHARS,
  DENSITY_MEDIUM_MAX_CHARS,
  CLOCK_SKEW_TOLERANCE,
  PLANNING_SYSTEM,
  REPLAN_SYSTEM,
  WORKSPACE_PLACEHOLDER,
  buildPlanningSystem,
  buildPlanningSystemBlank,
  PIPELINE_CTX_MAX_OUTPUT_LEN,
  PIPELINE_CTX_MAX_ERROR_LEN,
  PIPELINE_CTX_RECENT_LIMIT,
  PIPELINE_CTX_HARD_CAP,
  DEFAULT_MAX_TOTAL_MEMORIES,
  BROWSER_DEFAULT_VIEWPORT,
  LLM_KEY_NAMES,
  CLI_EXIT_INTERNAL_ERROR,
  CLI_EXIT_CONFIRM_DENIED,
  CLI_EXIT_SUCCESS,
  WINDOWS_CHCP_UTF8,
  CLI_REPL_PLAN_OUTPUT_MAX_LEN,
  isTestEnv,
  ifNotTest,
  VALID_TIERS,
  PRESET_ALERT_RULES,
  TRUST_AUTO_APPROVE_L2,
  TRUST_AUTO_APPROVE_L3,
  TRUST_BASE_SCORE,
  TRUST_L0_L1_BONUS,
  TRUST_L2_PENALTY,
  TRUST_L3_PENALTY,
  TRUST_L0_L1_PENALTY,
  type TrustRecord,
  computeTrustScore,
  shouldAutoApprove,
  // ── FSM Guard ──
  FSM_ARCHIVE_WEIGHT_THRESHOLD,
  FSM_RESTORE_ACCESS_THRESHOLD,
  FSM_OBLITERATE_DAYS_THRESHOLD,
  // ── ReAct ──
  REACT_CONTEXT_HARD_LIMIT,
  REACT_FORCE_WRITE_LOOP,
  REACT_HARD_REMINDER_LOOP,
  // ── Scheduler ──
  SCHEDULER_MAX_REPLAN_PER_NODE,
  SCHEDULER_MAX_TOTAL_REPLANS,
  SCHEDULER_MAX_DEGRADED_DRAINS,
  WORKER_POOL_MAX_QUEUE,
  CLAIM_LEASE_MS,
  NODE_DISPATCH_TIMEOUT_MS,
  EXECUTE_ALL_TIMEOUT_MS,
  // ── ConfirmGate ──
  CONFIRM_GATE_BYPASS_TTL_MS,
  // ── 记忆 ──
  BM25_DEFAULT_K1,
  BM25_DEFAULT_B,
  // ── 治理验证 ──
  VERIFICATION_CACHE_TTL_MS,
  BARREL_MAX_SIZE,
  TSFILE_MAX_SIZE,
  // ── Skill 结晶 ──
  SKILL_TRIAL_TO_ACTIVE_THRESHOLD,
  SKILL_ACTIVE_TO_DEPRECATED_THRESHOLD,
  SKILL_FEEDBACK_POSITIVE_WEIGHT,
  SKILL_FEEDBACK_NEGATIVE_WEIGHT,
  // R11-16：统一布尔 env 真值解析
  envTruthy,
} from "./constants/index.js";

// ── 密钥上下文（R11-09/10：modelFallback 链 + daemon 共享解析） ──
export { loadKeyContextEntries, resolveKeyChain } from "./keys-context.js";
export type { KeyContextEntry } from "./keys-context.js";

// ── 默认值 + 解析 ─────────────────────────────────
export {
  DEFAULT_ENGINE_CONFIG,
  resolveConfig,
} from "./defaults.js";

// ── 可插拔加载器 ──────────────────────────────────
export {
  // 域注册
  CONFIG_DOMAINS,
  // 加载函数
  loadConfigDomain,
  loadAllConfig,
  // 路径工具
  resolveConfigDataDir,
  // 错误类型
  ConfigLoadError,
  ConfigValidationError,
validateAllConfigs,
  validateConfigDomain,
} from "./loader.js";

export type {
  ConfigDomain,
  ConfigFileReader,
  CortexConfig,
  JsonSchema,
  SchemaValidationError,
} from "./loader.js";

export { validateJsonSchema, validateDomainWithSchema, validateSafe, validateOrThrow } from "./loader.js";

// ── 域级独立校验器 ───────────────────────────────
export {
  validates_models,
  safeValidates_models,
  validates_keysContext,
  safeValidates_keysContext,
  validates_agentManifests,
  safeValidates_agentManifests,
  validates_tuning,
  safeValidates_tuning,
  validates_tools,
  safeValidates_tools,
  validates_eventRouting,
  safeValidates_eventRouting,
} from "./schemas/validators.js";

// ── models.json → ModelCapabilities 解析 ─────────
export { resolveModelCapabilities } from "./models-capability.js";

// ── ConfigStore 持久层 ─────────────────────────────
export {
  ConfigStore,
  ModelStore,
  KeyStore,
  AgentManifestStore,
  TuningStore,
  createModelStore,
  createKeyStore,
  createAgentManifestStore,
  createTuningStore,
} from "./store.js";

export type {
  ConfigFileWriter,
} from "./store.js";

// ── Engine 层默认常量 ──────────────────────────────
export {
  DEFAULT_LOCK_TIMEOUT_MS,
  CLEANUP_INTERVAL_MS,
  SHUTDOWN_TIMEOUT_MS,
  SHUTDOWN_FORCE_EXIT_DELAY_MS,
  REACT_MAX_LOOPS,
  DEFAULT_ACQUIRE_TIMEOUT_MS,
  RETRIEVAL_ALPHA,
  RETRIEVAL_BETA,
  EMBEDDING_DIM,
  CONTENT_HASH_ALGO,
  VECTOR_DEDUP_THRESHOLD,
  WEIGHT_AGING_FACTOR,
  STALE_FREEZE_DAYS,
  FROZEN_OBLITERATE_DAYS,
  MAINTENANCE_WEIGHT_THRESHOLD,
  MAX_TOTAL_MEMORIES,
  SCHEMA_VERSION,
  MONITOR_WINDOW_MS,
  MONITOR_THRESHOLD,
  ENGINE_DEFAULTS,
  loadEngineDefaults,
} from "./engine-defaults.js";
export type { EngineDefaults } from "./engine-defaults.js";

// ── 治理事件路由表 ──
export { GOVERNANCE_EVENT_ROUTING } from "./governance-event-routing.js";

// ── 预设上下文策略库 ──
export { PRESET_CONTEXT_POLICIES } from "./data/context-policies.js";

// ── ConfigRegistry（Phase 3 基础设施）──
export { ConfigRegistry } from "./registry.js";

// ── 默认域注册入口（Phase 3）──
export { registerDefaultDomains } from "./registry.js";

// ── 词汇表（从 @cortex/shared 迁入的封闭类型）──
export {
  AgentType,
  AgentStatus,
  AgentContext,
} from "./vocabularies/agent-enums.js";
export {
  TAG_VOCABULARY,
  tagRegistry,
  TagRegistry,
  resolveTagVocabulary,
} from "./vocabularies/tags.js";
export type {
  Tag,
  TagPersistenceStore,
} from "./vocabularies/tags.js";
export {
  ToolCategory,
  ReversibilityLevel,
  TrustLevel,
  toReversibilityClass,
  toolNameToRiskDomain,
} from "./vocabularies/tool-enums.js";
export type {
  RiskDomain,
} from "./vocabularies/tool-enums.js";

