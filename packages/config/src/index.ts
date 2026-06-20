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
  AgentDefinition,
  AgentDisplay,
  AgentRoundtable,
  AgentsConfig,
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
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_CHAT_MODEL,
  DEFAULT_LLM_REASONER_MODEL,
  DEFAULT_CLI_CHAT_MODEL,
  DEFAULT_LLM_FALLBACK_MODEL,
  ENV_DEEPSEEK_CYRENE_API_KEY,
  ENV_DEEPSEEK_CHAT_API_KEY,
  ENV_DEEPSEEK_REASONER_API_KEY,
  ENV_DEEPSEEK_API_KEY,
  ENV_DEEPSEEK_BASE_URL,
  ENV_DEEPSEEK_CHAT_MODEL,
  ENV_DEEPSEEK_CYRENE_CHAT_MODEL,
  ENV_DEEPSEEK_REASONER_MODEL,
  ENV_DEEPSEEK_REASONING_EFFORT,
  ENV_CORTEX_API_AUDIT,
  ENV_CORTEX_NO_SEARCH,
  ENV_PM_MASTER_KEY,
  ENV_CONFIRM_GATE_TIMEOUT_MS,
  ENV_VITEST,
  ENV_NODE_ENV,
  FILE_CORTEX_AGENTS_JSON,
  FILE_PERSONA_TALK_TXT,
  DIR_CONSTITUTION,
  FILE_REPL_HISTORY,
  DIR_CORTEX,
  FILE_CYRENE_MEMORY_DB,
  FILE_SKILL_REGISTRY_JSON,
  FILE_CODING_STANDARDS,
  FILE_ENGINE_DB,
  FILE_CORTEX_COGNITION_JSON,
  FILE_CORTEX_DOCS_JSON,
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
} from "./constants/index.js";

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
} from "./loader.js";

export type {
  ConfigDomain,
  ConfigFileReader,
  CortexConfig,
} from "./loader.js";

// ── Engine 层默认常量 ──────────────────────────────
export {
  DEFAULT_LOCK_TIMEOUT_MS,
  CLEANUP_INTERVAL_MS,
  SHUTDOWN_TIMEOUT_MS,
  SHUTDOWN_FORCE_EXIT_DELAY_MS,
  SCHEDULER_MAX_ROUNDS,
  SCHEDULER_ROUND_TIMEOUT_MS,
  REACT_MAX_LOOPS,
  EMBEDDING_DIM,
  EMBEDDING_CACHE_SIZE,
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

