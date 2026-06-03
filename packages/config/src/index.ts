/**
 * @cortex/config — 统一配置包桶导出
 *
 * 三层结构：
 *   interfaces  — 配置类型（纯接口）
 *   constants   — 字符串/数字常量
 *   defaults    — 默认值对象 + resolveConfig 合并函数
 *
 * @layer root — 零依赖，全局唯一真相源
 */

// ── 接口 ────────────────────────────────────────
export type {
  EngineConfig,
  ToolTimeoutsConfig,
  InspectorConfig,
  LlmConfig,
  FilePathsConfig,
  SkillSystemConfig,
  SearchProviderConfig,
  SearchAggregationConfig,
  SearchConfig,
  OutputFormat,
} from "./interfaces.js";

export { OUTPUT_FORMATS } from "./interfaces.js";

// ── 常量 ────────────────────────────────────────
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
} from "./constants.js";

// ── 默认值 + 解析 ───────────────────────────────
export {
  DEFAULT_ENGINE_CONFIG,
  resolveConfig,
} from "./defaults.js";
