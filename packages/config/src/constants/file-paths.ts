/**
 * @cortex/config — 文件与目录路径常量
 *
 * @module constants/file-paths
 * @layer root
 */

/** Agent 配置文件名 */
export const FILE_CORTEX_AGENTS_JSON = "cortex-agents.json";

/** Persona 人设文件目录（.cortex/lore/{character}/ 下） */
export const DIR_LORE = "lore";

/** 昔涟闲聊 persona 文件（.cortex/lore/cyrene/ 下） */
export const FILE_PERSONA_TALK_TXT = "persona-talk.txt";

/** Persona 档案文件名 */
export const FILE_PERSONA_PROFILE = "profile.md";

/** Persona 性格文件名 */
export const FILE_PERSONA_PERSONALITY = "personality.md";

/** 宪法文件所在目录 */
export const DIR_CONSTITUTION = "docs/constitution";

/** 修宪提案归档目录（相对于项目根目录） */
export const DIR_AMENDMENTS = "docs/amendments";

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
