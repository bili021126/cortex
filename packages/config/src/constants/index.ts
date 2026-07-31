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
  TOOL_EXECUTION_TIMEOUT_MS,
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

// ── ConfirmGate 信任分阈值 ──
export {
  TRUST_AUTO_APPROVE_L2,
  TRUST_AUTO_APPROVE_L3,
  TRUST_BASE_SCORE,
  TRUST_L0_L1_BONUS,
  TRUST_L2_PENALTY,
  TRUST_L3_PENALTY,
  CONFIRM_GATE_BYPASS_TTL_MS,
} from "./confirm-gate.js";

// ── 遥测告警规则 ──
export { PRESET_ALERT_RULES } from "./alert-rules.js";

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

// ── 调度常量 ──
export {
  CLOCK_SKEW_TOLERANCE,
} from "./scheduling.js";

// ── 记忆常量（Phase 4 收敛）──
export {
  EMBEDDING_DIM,
  VECTOR_DEDUP_THRESHOLD,
  WEIGHT_AGING_FACTOR,
  STALE_FREEZE_DAYS,
  FROZEN_OBLITERATE_DAYS,
  MAINTENANCE_WEIGHT_THRESHOLD,
  SCHEMA_VERSION,
  BM25_DEFAULT_K1,
  BM25_DEFAULT_B,
} from "./memory.js";

// ── 治理验证常量 ──
export {
  VERIFICATION_CACHE_TTL_MS,
  BARREL_MAX_SIZE,
  TSFILE_MAX_SIZE,
} from "./governance.js";

// ── Tier 校验常量（Phase 4 收敛）──
export { VALID_TIERS } from "./tiers.js";

// ── FSM Guard 条件配置 ──
export {
  FSM_ARCHIVE_WEIGHT_THRESHOLD,
  FSM_RESTORE_ACCESS_THRESHOLD,
  FSM_OBLITERATE_DAYS_THRESHOLD,
} from "./fsm-guards.js";

// ── ReAct 硬检测参数 ──
export {
  REACT_MAX_LOOPS,
  REACT_CONTEXT_HARD_LIMIT,
  REACT_FORCE_WRITE_LOOP,
  REACT_HARD_REMINDER_LOOP,
} from "./react-strategy.js";

// ── Scheduler 调度参数 ──
export {
  SCHEDULER_MAX_REPLAN_PER_NODE,
  SCHEDULER_MAX_TOTAL_REPLANS,
  SCHEDULER_MAX_DEGRADED_DRAINS,
  SCHEDULER_ROUND_TIMEOUT_MS,
  WORKER_POOL_MAX_QUEUE,
  CLAIM_LEASE_MS,
  NODE_DISPATCH_TIMEOUT_MS,
  EXECUTE_ALL_TIMEOUT_MS,
} from "./scheduler-params.js";

// ── 技能结晶权重阈值 ──
export {
  SKILL_TRIAL_TO_ACTIVE_THRESHOLD,
  SKILL_ACTIVE_TO_DEPRECATED_THRESHOLD,
  SKILL_FEEDBACK_POSITIVE_WEIGHT,
  SKILL_FEEDBACK_NEGATIVE_WEIGHT,
} from "./skill-crystallization.js";

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
