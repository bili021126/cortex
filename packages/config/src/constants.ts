/**
 * @cortex/config — 统一常量定义
 *
 * 所有魔法数字、版本字符串、环境变量名、文件/目录路径集中于此。
 * 零运行时依赖，纯常量层。
 *
 * @module constants
 * @layer root — 所有包共同依赖的常量层
 */

// ════════════════════════════════════════════════════════
// 版本信息
// ════════════════════════════════════════════════════════

/** CLI 自身版本 */
export const CORTEX_VERSION = "0.2.1";

/** Core-1 阶段标识 */
export const CORTEX_PHASE = "Core-1";

/** 依赖包版本（同步自各包 package.json） */
export const DEPENDENCY_VERSIONS: Record<string, string> = {
  engine: "@cortex/engine v2.1.0",
  llm: "@cortex/llm v0.3.0",
  shared: "@cortex/shared v2.0.0",
};

// ════════════════════════════════════════════════════════
// Agent 配额
// ════════════════════════════════════════════════════════

/** Agent 最大并发实例数 */
export const DEFAULT_AGENT_QUOTA: Record<string, number> = {
  default: 2,
  code: 4,
  review: 2,
  analysis: 2,
  inspector: 1,
};

// ════════════════════════════════════════════════════════
// 超时
// ════════════════════════════════════════════════════════

/** 任务执行默认超时（秒） */
export const DEFAULT_TASK_TIMEOUT_SEC = 300;

/** 命令分发超时（秒） */
export const DEFAULT_COMMAND_TIMEOUT_SEC = 60;

/** 输出格式默认值 */
export const DEFAULT_OUTPUT_FORMAT = "text" as const;

// ════════════════════════════════════════════════════════
// LLM 默认值
// ════════════════════════════════════════════════════════

/** DeepSeek API 默认 Base URL */
export const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com/v1";

/** DeepSeek Chat 默认模型名 */
export const DEFAULT_LLM_CHAT_MODEL = "deepseek-chat";

/** DeepSeek Reasoner 默认模型名 */
export const DEFAULT_LLM_REASONER_MODEL = "deepseek-reasoner";

/** ConfigManager 默认聊天模型 */
export const DEFAULT_CLI_CHAT_MODEL = "deepseek-v4-flash";

/** LLM 回退模型名 */
export const DEFAULT_LLM_FALLBACK_MODEL = "deepseek-chat";

// ════════════════════════════════════════════════════════
// 环境变量名称
// ════════════════════════════════════════════════════════

/** DeepSeek 昔涟（独立人格）API 密钥环境变量名 */
export const ENV_DEEPSEEK_CYRENE_API_KEY = "DEEPSEEK_CYRENE_API_KEY";

/** DeepSeek Chat 模型 API 密钥环境变量名 */
export const ENV_DEEPSEEK_CHAT_API_KEY = "DEEPSEEK_CHAT_API_KEY";

/** DeepSeek Reasoner 模型 API 密钥环境变量名 */
export const ENV_DEEPSEEK_REASONER_API_KEY = "DEEPSEEK_REASONER_API_KEY";

/** DeepSeek API 密钥环境变量名（回退 Key） */
export const ENV_DEEPSEEK_API_KEY = "DEEPSEEK_API_KEY";

/** DeepSeek Base URL 环境变量名 */
export const ENV_DEEPSEEK_BASE_URL = "DEEPSEEK_BASE_URL";

/** DeepSeek Chat 模型环境变量名 */
export const ENV_DEEPSEEK_CHAT_MODEL = "DEEPSEEK_CHAT_MODEL";

/** DeepSeek Reasoner 模型环境变量名 */
export const ENV_DEEPSEEK_REASONER_MODEL = "DEEPSEEK_REASONER_MODEL";

/** DeepSeek Reasoning Effort 环境变量名 */
export const ENV_DEEPSEEK_REASONING_EFFORT = "DEEPSEEK_REASONING_EFFORT";

/** Cortex 功能开关环境变量 */
export const ENV_CORTEX_API_AUDIT = "CORTEX_API_AUDIT";

/** 禁用搜索后端的 flag */
export const ENV_CORTEX_NO_SEARCH = "CORTEX_NO_SEARCH";

/** PM 主密钥环境变量名 */
export const ENV_PM_MASTER_KEY = "PM_MASTER_KEY";

/** ConfirmGate 超时环境变量名 */
export const ENV_CONFIRM_GATE_TIMEOUT_MS = "CONFIRM_GATE_TIMEOUT_MS";

/** VITEST 环境变量名（测试模式检测） */
export const ENV_VITEST = "VITEST";

/** NODE_ENV 环境变量名 */
export const ENV_NODE_ENV = "NODE_ENV";

// ════════════════════════════════════════════════════════
// 文件与目录路径
// ════════════════════════════════════════════════════════

/** Agent 配置文件名 */
export const FILE_CORTEX_AGENTS_JSON = "cortex-agents.json";

/** 昔涟闲聊 persona 文件（.cortex 目录下） */
export const FILE_PERSONA_TALK_TXT = "persona-talk.txt";

/** 宪法文件所在目录 */
export const DIR_CONSTITUTION = "docs/constitution";

/** REPL 历史文件（用户目录下的 .cortex 子目录） */
export const FILE_REPL_HISTORY = "repl-history";

/** .cortex 隐藏目录名 */
export const DIR_CORTEX = ".cortex";

/** 昔涟独立记忆数据库文件名（.cortex 目录下） */
export const FILE_CYRENE_MEMORY_DB = "cyrene-memory.db";

/** 技能注册表 JSON 快照文件名（.cortex 目录下） */
export const FILE_SKILL_REGISTRY_JSON = "skill-registry.json";

/** 编码规范文件路径（相对项目根目录） */
export const FILE_CODING_STANDARDS = "prompts/coding-standards.md";

/** 引擎数据库文件名（.cortex 目录下） */
export const FILE_ENGINE_DB = "engine.db";

/** 认知配置文件 */
export const FILE_CORTEX_COGNITION_JSON = "cortex-cognition.json";

/** 文档配置文件名 */
export const FILE_CORTEX_DOCS_JSON = "cortex-docs.json";

/** 用户全局配置目录名（~/.cortex/ 下的目录名） */
export const DIR_GLOBAL_CONFIG = ".cortex";

/** 本地配置文件名 */
export const FILE_LOCAL_CONFIG = ".cortex/config";

/** 环境变量文件名 */
export const FILE_DOTENV = ".env";

/** prompts 目录名 */
export const DIR_PROMPTS = "prompts";

/** 修宪提案超时计数器文件名 */
export const FILE_TIMEOUT_COUNTERS = ".timeout-counters.json";

/** hash 缓存文件名 */
export const FILE_HASH_CACHE = "hash-cache.json";

// ════════════════════════════════════════════════════════
// 技能系统默认值
// ════════════════════════════════════════════════════════

/** 可执行技能默认超时 (ms) */
export const DEFAULT_SKILL_TIMEOUT_MS = 30_000;

/** 可执行技能默认最大重试次数 */
export const DEFAULT_SKILL_MAX_RETRIES = 0;

// ════════════════════════════════════════════════════════
// 修宪默认值
// ════════════════════════════════════════════════════════

/** 修宪默认超时天数配置 */
export const DEFAULT_AMENDMENT_TIMEOUT = {
  /** pending_judgment 超时天数 */
  judgmentTTLDays: 7,
  /** draft 超时天数 */
  draftTTLDays: 14,
  /** 连续超时自动拒绝的阈值 */
  maxStaleCount: 3,
} as const;
