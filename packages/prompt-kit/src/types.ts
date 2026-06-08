/**
 * @cortex/prompt-kit — 核心类型定义
 *
 * 本文件定义了提示词工程工具包的所有核心类型。
 * 包括：PromptBlockType / PromptBlock / PromptTemplate / PromptContext /
 *       PromptResult / PromptAssembly / PromptLoadOptions 等。
 *
 * @see DESIGN.md §2 核心类型定义
 */

// ============================================================
// 1. 提示词语义块类型
// ============================================================

/**
 * 提示词语义块类型枚举。
 * 每个块代表一段具有独立语义的提示词内容。
 */
export enum PromptBlockType {
  /** 身份声明 — "你是 XX，你的职责是 YY" */
  Identity = "identity",
  /** 角色人格 — persona 定义：语气、风格、背景故事 */
  Persona = "persona",
  /** 上下文注入 — 工程上下文、记忆检索结果、当前任务 */
  Context = "context",
  /** 行为指令 — 约束规则、输出格式、行为边界 */
  Instruction = "instruction",
  /** 示例注入 — few-shot 示例 */
  Example = "example",
  /** 输出格式定义 — 预期输出结构 */
  OutputFormat = "output_format",
  /** 私有内容 — 仅特定场景注入的敏感内容 */
  Private = "private",
}

/**
 * 提示词语义块。
 * 每个块是 prompt 的最小可组合单元。
 */
export interface PromptBlock {
  /** 块唯一标识 */
  id: string;
  /** 块类型 */
  type: PromptBlockType;
  /** 块内容（支持模板语法） */
  content: string;
  /** 优先级（排序用，小值优先） */
  priority: number;
  /** 可选 — 激活条件（表达式） */
  condition?: string;
  /** 可选 — 访问级别标记 */
  accessLevel?: "public" | "restricted" | "private";
  /** 可选 — 标签（用于按标签组引用） */
  tags?: string[];
  /** 可选 — 渲染上下文扩展 */
  metadata?: Record<string, unknown>;
}

// ============================================================
// 2. 提示词模板
// ============================================================

/**
 * 提示词模板——一组有序的语义块组合。
 * 模板是 prompt 的声明式定义：由多个 PromptBlock 按优先级排序组成。
 */
export interface PromptTemplate {
  /** 模板唯一标识 */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板版本（semver） */
  version: string;
  /** 语义块列表（渲染时按 priority 排序） */
  blocks: PromptBlock[];
  /** 适用场景标签 */
  tags: string[];
  /** 可选 — 描述 */
  description?: string;
  /** 可选 — 来源（文件路径/配置标识/内联） */
  source?: string;
  /** 可选 — 扩展元数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================
// 3. 渲染上下文
// ============================================================

/**
 * 提示词渲染上下文。
 * 提供给模板引擎的变量集和运行时信息。
 */
export interface PromptContext {
  /** 模板变量 */
  variables: Record<string, unknown>;
  /** 当前 Agent 类型 */
  agentType?: string;
  /** 当前任务信息 */
  task?: {
    id: string;
    type: string;
    tags: string[];
    payload: string;
  };
  /** 记忆上下文 */
  memoryContext?: string;
  /** 活跃的块 ID 列表（用于动态启用/禁用块） */
  activeBlockIds?: string[];
  /** 自定义块过滤器 */
  blockFilter?: (block: PromptBlock) => boolean;
  /** 扩展上下文 */
  [key: string]: unknown;
}

// ============================================================
// 4. 渲染结果
// ============================================================

/**
 * 提示词渲染结果。
 */
export interface PromptResult {
  /** 完整渲染后的文本 */
  text: string;
  /** 模板 ID */
  templateId: string;
  /** 模板版本 */
  version: string;
  /** 实际渲染的块列表（含优先级排序后） */
  renderedBlocks: Array<{
    id: string;
    type: PromptBlockType;
    content: string;
    order: number;
  }>;
  /** 跳过未渲染的块（因 condition 不满足） */
  skippedBlocks: Array<{
    id: string;
    type: PromptBlockType;
    reason: "condition_false" | "filtered" | "access_denied" | "blocked";
  }>;
  /** 渲染耗时 */
  renderTimeMs: number;
  /** 时间戳 */
  timestamp: number;
}

// ============================================================
// 5. 加载选项
// ============================================================

/**
 * 提示词加载选项。
 */
export interface PromptLoadOptions {
  /** 加载策略 */
  strategy?: "file_first" | "config_first" | "inline_only" | "merge";
  /** 是否缓存已加载的模板 */
  useCache?: boolean;
  /** 缓存 TTL（毫秒） */
  cacheTtlMs?: number;
  /** 文件系统基础路径 */
  baseDir?: string;
  /** 访问级别校验（拒绝低于该级别的块） */
  minAccessLevel?: "public" | "restricted" | "private";
}

// ============================================================
// 6. 组装配置
// ============================================================

/**
 * 提示词组装配置。
 * 定义如何将多个 PromptBlock 组合为最终 system prompt。
 */
export interface PromptAssembly {
  /** 基础模板 ID（优先加载） */
  baseTemplateId?: string;
  /** 额外块列表（追加到 base 之后） */
  additionalBlocks?: PromptBlock[];
  /** 渲染上下文 */
  context: PromptContext;
  /** 块排序策略 */
  sortStrategy?: "by_priority" | "by_type" | "custom";
  /** 自定义分隔符（默认 \n\n） */
  blockSeparator?: string;
  /** 是否注入共享身份锚点 */
  injectIdentityAnchor?: boolean;
}

// ============================================================
// 7. 缓存相关
// ============================================================

/**
 * 提示词缓存条目。
 */
export interface PromptCacheEntry {
  template: PromptTemplate;
  compiledAt: number;
  accessCount: number;
  lastAccessedAt: number;
  ttlMs: number;
}

/**
 * 缓存统计。
 */
export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  typeStats?: Record<string, { hits: number; misses: number }>;
}

// ============================================================
// 8. 校验相关
// ============================================================

/**
 * 校验结果。
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

/**
 * 校验错误。
 */
export interface ValidationError {
  path: string;
  message: string;
  severity: "error" | "warning";
  code?: string;
}

/**
 * 段检查结果。
 */
export interface SectionCheckResult {
  allPresent: boolean;
  present: PromptBlockType[];
  missing: PromptBlockType[];
  warnings: string[];
}

// ============================================================
// 9. 版本管理
// ============================================================

/**
 * 版本记录。
 */
export interface VersionRecord {
  templateId: string;
  version: string;
  previousVersion?: string;
  changeDescription: string;
  changedBy: string;
  timestamp: number;
  blocksChanged: string[];
  source?: string;
}

/**
 * 版本差异。
 */
export interface VersionDiff {
  templateId: string;
  from: string;
  to: string;
  additions: string[];
  removals: string[];
  modifications: Array<{
    blockId: string;
    type: PromptBlockType;
    before: string;
    after: string;
  }>;
}

// ============================================================
// 10. 错误
// ============================================================

/** Prompt 错误码枚举 */
export enum PromptErrorCode {
  TEMPLATE_NOT_FOUND = "PROMPT_TEMPLATE_NOT_FOUND",
  LOAD_FAILED = "PROMPT_LOAD_FAILED",
  VALIDATION_FAILED = "PROMPT_VALIDATION_FAILED",
  RENDER_FAILED = "PROMPT_RENDER_FAILED",
  VARIABLE_UNDEFINED = "PROMPT_VARIABLE_UNDEFINED",
  SYNTAX_ERROR = "PROMPT_SYNTAX_ERROR",
  CIRCULAR_REFERENCE = "PROMPT_CIRCULAR_REFERENCE",
  CACHE_ERROR = "PROMPT_CACHE_ERROR",
  ACCESS_DENIED = "PROMPT_ACCESS_DENIED",
}

// ============================================================
// 11. 编排器选项
// ============================================================

/**
 * PromptOrchestrator 配置选项。
 */
export interface OrchestratorOptions {
  /** 文件系统基础路径（默认 process.cwd()） */
  baseDir?: string;
  /** 缓存最大条目数（默认 100） */
  cacheMaxSize?: number;
  /** 默认缓存 TTL 毫秒（默认 300_000 = 5 分钟） */
  cacheDefaultTtlMs?: number;
  /** 是否注入共享身份锚点（默认 true） */
  injectIdentityAnchor?: boolean;
  /** 是否启用文件变动监听（默认 false） */
  enableFileWatching?: boolean;
  /** Prompt 模板引擎配置 */
  engineOptions?: TemplateEngineOptions;
}

/**
 * 模板引擎配置。
 */
export interface TemplateEngineOptions {
  /** 变量插值分隔符，默认 ["{{", "}}"] */
  delimiters?: [string, string];
  /** 未定义变量时的默认值，默认 "" */
  undefinedPlaceholder?: string;
  /** 是否启用 HTML 转义，默认 false */
  escapeHtml?: boolean;
  /** 最大嵌套深度（用于 {{#ref}}/{{#include}}），默认 5 */
  maxNestingDepth?: number;
}
