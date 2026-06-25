/**
 * @cortex/config — 常量总桶导出
 *
 * 所有字符串/数字常量按职责域拆分，统一从此处导出。
 *
 * @module constants/index
 * @layer root — 所有包共同依赖的常量层
 */

// ── 版本 ──
export {
  CORTEX_VERSION,
  CORTEX_PHASE,
  DEPENDENCY_VERSIONS,
} from "./version.js";

// ── Agent 配额 ──
export { DEFAULT_AGENT_QUOTA } from "./agent-quota.js";

// ── 超时 ──
export {
  DEFAULT_TASK_TIMEOUT_SEC,
  DEFAULT_COMMAND_TIMEOUT_SEC,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_MAX_TOOL_ROUNDS,
} from "./timeouts.js";

// ── LLM ──
export {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_CHAT_MODEL,
  DEFAULT_LLM_REASONER_MODEL,
  DEFAULT_CLI_CHAT_MODEL,
  DEFAULT_LLM_FALLBACK_MODEL,
  LLM_KEY_NAMES,
} from "./llm.js";

// ── 环境变量 ──
export {
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
} from "./env.js";

// ── 文件路径 ──
export {
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
  DIR_AMENDMENTS,
} from "./file-paths.js";

// ── 技能 ──
export {
  DEFAULT_SKILL_TIMEOUT_MS,
  DEFAULT_SKILL_MAX_RETRIES,
} from "./skills.js";

// ── 修宪 ──
export { DEFAULT_AMENDMENT_TIMEOUT } from "./amendment.js";

// ── RLM 递归拆解 & DENSITY 密度 ──
export {
  RLM_MIN_CONFIDENCE,
  RLM_MAX_DEPTH,
  RLM_MIN_COMPLEXITY_CHARS,
  DENSITY_LIGHT_MAX_CHARS,
  DENSITY_MEDIUM_MAX_CHARS,
} from "./rlm.js";

// ── MetaAgent 提示词 ──
export {
  PLANNING_SYSTEM,
  REPLAN_SYSTEM,
  WORKSPACE_PLACEHOLDER,
  buildPlanningSystem,
  buildPlanningSystemBlank,
} from "./meta-agent.js";

// ── 管线上下文 ──
export {
  PIPELINE_CTX_MAX_OUTPUT_LEN,
  PIPELINE_CTX_MAX_ERROR_LEN,
  PIPELINE_CTX_RECENT_LIMIT,
  PIPELINE_CTX_HARD_CAP,
  DEFAULT_MAX_TOTAL_MEMORIES,
  BROWSER_DEFAULT_VIEWPORT,
  CLI_EXIT_INTERNAL_ERROR,
  CLI_EXIT_CONFIRM_DENIED,
  CLI_EXIT_SUCCESS,
  WINDOWS_CHCP_UTF8,
  CLI_REPL_PLAN_OUTPUT_MAX_LEN,
} from "./pipeline.js";

// ── 记忆常量（Phase 4 收敛）──
export {
  EMBEDDING_DIM,
  VECTOR_DEDUP_THRESHOLD,
  WEIGHT_AGING_FACTOR,
  STALE_FREEZE_DAYS,
  FROZEN_OBLITERATE_DAYS,
  MAINTENANCE_WEIGHT_THRESHOLD,
  SCHEMA_VERSION,
} from "./memory.js";

// ── Tier 校验常量（Phase 4 收敛）──
export { VALID_TIERS } from "./tiers.js";

// ── 测试环境检测 ──────────────────────────────────
import { ENV_VITEST as _ENV_VITEST, ENV_NODE_ENV as _ENV_NODE_ENV } from "./env.js";
/**
 * 测试环境检测 —— 替代散落在各处的 `process.env.ENV_VITEST` 硬编码。
 * engine 和 scheduler 共用这一份实现。
 */
export function isTestEnv(): boolean {
  return !!process.env[_ENV_VITEST] || !!process.env[_ENV_NODE_ENV]?.startsWith("test");
}

/** 仅在非测试环境下执行回调 */
export function ifNotTest(fn: () => void): void {
  if (!isTestEnv()) {
    fn();
  }
}
