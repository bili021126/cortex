/**
 * @cortex/skill-kit — 核心类型定义
 *
 * 本文件定义了技能系统的所有核心类型，包括：
 * - SkillDefinition: 技能定义（开发者视角）
 * - SkillMeta: 技能元信息
 * - SkillContext: 执行上下文
 * - SkillOutput: 执行结果
 * - SkillError: 技能错误
 * - SkillManifest: JSON 技能清单
 * - 各类接口（Loader / Validator / Executor / Cache）
 *
 * @see docs/design.md §3 核心类型定义
 */

// ============================================================
// 1. 技能分类与枚举
// ============================================================

/**
 * 技能分类枚举。
 * 与 @cortex/engine 的 SkillCategory 保持一致。
 */
export enum SkillCategory {
  DATA = "data",
  NLP = "nlp",
  TOOL = "tool",
  REASONING = "reasoning",
  MEMORY = "memory",
  COMMUNICATION = "communication",
  SYSTEM = "system",
}

/**
 * 技能错误码枚举。
 */
export enum SkillErrorCode {
  NOT_FOUND = "SKILL_NOT_FOUND",
  LOAD_FAILED = "SKILL_LOAD_FAILED",
  VALIDATION_FAILED = "SKILL_VALIDATION_FAILED",
  EXECUTION_FAILED = "SKILL_EXECUTION_FAILED",
  TIMEOUT = "SKILL_TIMEOUT",
  ABORTED = "SKILL_ABORTED",
  INIT_FAILED = "SKILL_INIT_FAILED",
  INTERNAL_ERROR = "SKILL_INTERNAL_ERROR",
}

// ============================================================
// 2. 技能元信息
// ============================================================

/**
 * 技能元信息——描述技能的身份、分类、能力。
 */
export interface SkillMeta {
  /** 唯一标识符（如 "skill-p10-ci-gate"） */
  id: string;

  /** 展示名称（如 "CI 门禁全流程"），支持中文 */
  name: string;

  /** 语义化版本号（遵循 semver，如 "1.0.0"） */
  version: string;

  /** 详细描述——解释技能的能力、适用场景 */
  description: string;

  /** 技能类别 */
  category: SkillCategory;

  /** 触发标签——与 Agent 标签匹配 */
  triggerTags: string[];

  /** 触发条件描述（自然语言，供 LLM 理解） */
  trigger: string;

  /** 执行步骤（自然语言描述，供 LLM 注入使用） */
  steps: string[];

  /** 预期产出描述 */
  expectedOutput: string;

  /** 技能作者 */
  author?: string;

  /** 依赖的其他技能 ID 列表 */
  dependencies?: string[];

  /** 入口文件路径（相对于 skills/ 目录），供 loadFromFile 使用 */
  entry?: string;

  /** （可选）输入参数 JSON Schema */
  inputSchema?: Record<string, unknown>;

  /** （可选）输出结果 JSON Schema */
  outputSchema?: Record<string, unknown>;

  /** 支持的操作系统平台 */
  platforms?: Array<"node" | "browser" | "worker">;

  /** 自定义扩展元数据 */
  extensions?: Record<string, unknown>;

  /** 创建时间戳 */
  createdAt?: number;
}

// ============================================================
// 3. 技能定义（核心类型）
// ============================================================

/**
 * 技能定义——开发者编写技能时的核心类型。
 *
 * 兼容两种形态：
 * 1. TypeScript 模块（.ts）—— 完整实现，通过 export default 导出
 * 2. JSON 文件（.json）—— 仅声明元信息 + 步骤，执行时由适配器包装
 *
 * @template TInput  技能输入参数类型
 * @template TOutput 技能输出结果类型
 * @template TEnv    执行环境依赖类型（可选，用于依赖注入）
 */
export interface SkillDefinition<
  TInput = unknown,
  TOutput = unknown,
  TEnv = Record<string, unknown>,
> {
  /** 技能元信息 */
  meta: SkillMeta;

  /**
   * 技能主执行函数。
   * 接受 SkillContext 上下文，返回执行结果。
   * 支持异步，支持 AbortSignal 中止。
   */
  execute(ctx: SkillContext<TInput, TEnv>): Promise<SkillOutput<TOutput>>;

  /**
   * （可选）输入参数校验函数。
   * 返回 true 表示参数有效，false 表示无效。
   * 未实现时使用 meta.inputSchema 做 JSON Schema 校验。
   */
  validateInput?(input: unknown): input is TInput;

  /**
   * （可选）技能初始化钩子——在技能第一次执行前调用。
   * 可用于建立连接、加载资源等。
   */
  onInit?(ctx: SkillInitContext<TEnv>): Promise<void>;

  /**
   * （可选）技能销毁钩子——在技能被卸载时调用。
   * 可用于释放资源、关闭连接等。
   */
  onDestroy?(): Promise<void>;
}

// ============================================================
// 4. 执行上下文
// ============================================================

/**
 * 技能执行上下文——技能执行时接收的运行时环境。
 */
export interface SkillContext<TInput = unknown, TEnv = Record<string, unknown>> {
  /** 技能输入参数 */
  input: TInput;

  /** 环境依赖注入（toolkit, memory, llm 等） */
  env: TEnv;

  /** 中止信号（超时 / 手动取消） */
  signal: AbortSignal;

  /** 结构化日志记录器 */
  logger: SkillLogger;

  /** 上下文存储（技能间共享临时数据） */
  store: Map<string, unknown>;

  /** 调用方跟踪 ID */
  traceId: string;
}

/**
 * 技能初始化上下文——onInit 钩子接收的环境。
 * 比 SkillContext 更轻量，不含 input。
 */
export interface SkillInitContext<TEnv = Record<string, unknown>> {
  env: TEnv;
  logger: SkillLogger;
}

/**
 * 结构化日志接口。
 * 与 @cortex/engine 的 Logger 接口保持一致。
 */
export interface SkillLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

// ============================================================
// 5. 执行结果
// ============================================================

/**
 * 技能执行结果。
 *
 * 遵循 Result 模式（成功/失败判别联合）：
 * - success: true  → data 包含输出
 * - success: false → error 包含错误信息
 */
export type SkillOutput<TOutput = unknown> =
  | { success: true; data: TOutput; meta?: ExecutionMeta }
  | { success: false; error: SkillError; meta?: ExecutionMeta };

/**
 * 执行元信息——记录技能执行的运行时数据。
 */
export interface ExecutionMeta {
  /** 执行耗时（毫秒） */
  duration: number;
  /** 实际使用的技能版本 */
  version: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 技能错误。
 */
export interface SkillError {
  code: SkillErrorCode;
  message: string;
  details?: unknown;
  cause?: Error;
}

// ============================================================
// 6. JSON 技能清单
// ============================================================

/**
 * 技能清单——JSON 文件格式的技能声明。
 *
 * 对应 skills/ 目录下的 *.json 文件。
 * 与 SkillTemplate 结构兼容，扩展了 version/category 字段。
 */
export interface SkillManifest {
  /** 技能唯一标识 */
  id: string;
  /** 归属 Agent 类型 */
  agentType: string;
  /** 展示名称 */
  name: string;
  /** 版本号 */
  version?: string;
  /** 技能类别 */
  category?: SkillCategory;
  /** 触发标签 */
  triggerTags: string[];
  /** 触发条件 */
  trigger: string;
  /** 步骤序列 */
  steps: string[];
  /** 预期产出 */
  expectedOutput: string;
  /** 输出文件模板 */
  outputFile?: string;
  /** 技能状态 */
  status?: "draft" | "trial" | "active" | "deprecated";
  /** 作者 */
  discoveredBy?: string;
  /** 创建时间 */
  createdAt?: number;
}

// ============================================================
// 7. 校验结果
// ============================================================

/**
 * 校验结果。
 */
export interface ValidationResult {
  /** 是否完全通过校验 */
  valid: boolean;
  /** 校验错误列表（valid=true 时为空数组） */
  errors: ValidationError[];
  /** 校验警告列表（不影响 valid 状态） */
  warnings: string[];
}

/**
 * 校验错误。
 */
export interface ValidationError {
  /** 错误字段路径（如 "meta.name"） */
  path: string;
  /** 错误信息 */
  message: string;
  /** 错误严重级别 */
  severity: "error" | "warning";
}

// ============================================================
// 8. 执行选项
// ============================================================

/**
 * 执行选项。
 */
export interface ExecuteOptions {
  /** 环境依赖注入 */
  env?: Record<string, unknown>;
  /** 超时时间（毫秒），默认 30_000 */
  timeout?: number;
  /** 自定义日志记录器 */
  logger?: SkillLogger;
  /** 调用方跟踪 ID */
  traceId?: string;
}

// ============================================================
// 9. 接口定义
// ============================================================

/**
 * 技能加载器接口——按 ID 或文件路径加载技能定义。
 */
export interface SkillLoader {
  /**
   * 按技能 ID 加载。
   * 内部通过注册的映射表查找技能入口路径，然后调用 loadFromFile。
   */
  load(skillId: string): Promise<SkillDefinition>;

  /**
   * 从文件路径加载技能。
   *
   * 根据文件后缀决定加载策略：
   * - .ts  → dynamic import() + 运行时编译
   * - .json → JSON.parse + 包装为 SkillDefinition（steps 注入 prompt）
   * - .js  → dynamic import()
   */
  loadFromFile(filePath: string): Promise<SkillDefinition>;

  /**
   * 注册技能入口路径。
   * 建立 skillId → filePath 的映射。
   */
  register(skillId: string, filePath: string): void;

  /**
   * 批量注册技能入口。
   */
  registerMany(entries: Array<{ id: string; path: string }>): void;
}

/**
 * 技能校验器接口——校验 SkillDefinition 的完整性。
 */
export interface SkillValidator {
  /**
   * 校验技能定义。
   * @returns 校验结果，包含所有错误信息。
   */
  validate(skill: SkillDefinition): ValidationResult;

  /**
   * 校验技能元信息。
   * 轻量级校验——不要求有完整的 SkillDefinition。
   */
  validateMeta(meta: SkillMeta): ValidationResult;

  /**
   * 校验 JSON 技能清单。
   * 将 SkillManifest 转为 SkillMeta 后再校验。
   */
  validateManifest(manifest: SkillManifest): ValidationResult;
}

/**
 * 技能执行器接口——执行技能定义并返回结果。
 */
export interface SkillExecutor {
  /**
   * 执行技能。
   *
   * @param skill   技能定义
   * @param input   技能输入参数
   * @param options 执行选项（超时、环境依赖等）
   * @returns 执行结果
   */
  execute<TInput, TOutput>(
    skill: SkillDefinition<TInput, TOutput>,
    input: TInput,
    options?: ExecuteOptions,
  ): Promise<SkillOutput<TOutput>>;
}

/**
 * 技能缓存接口——缓存已加载/已初始化的技能定义。
 */
export interface SkillCache {
  /**
   * 获取缓存的技能定义。
   * 返回 undefined 表示缓存未命中。
   */
  get(skillId: string): SkillDefinition | undefined;

  /**
   * 设置缓存。
   * @param ttlMs 可选——自定义 TTL，不传则使用默认 TTL。
   */
  set(skillId: string, skill: SkillDefinition, ttlMs?: number): void;

  /**
   * 检查技能是否在缓存中。
   */
  has(skillId: string): boolean;

  /**
   * 主动失效指定技能缓存。
   */
  evict(skillId: string): void;

  /**
   * 清空所有缓存。
   */
  clear(): void;

  /**
   * 获取缓存统计信息（命中率、大小等）。
   */
  stats(): CacheStats;
}

/**
 * 缓存统计。
 */
export interface CacheStats {
  /** 缓存条目数 */
  size: number;
  /** 缓存最大容量 */
  maxSize: number;
  /** 命中次数 */
  hits: number;
  /** 未命中次数 */
  misses: number;
  /** 命中率 */
  hitRate: number;
}

// ============================================================
// 10. 模板引擎类型
// ============================================================

/**
 * 模板引擎配置选项。
 */
export interface TemplateEngineOptions {
  /** 变量插值分隔符，默认 ["{{", "}}"] */
  delimiters?: [string, string];
  /** 未定义变量时的默认值，默认 "" */
  undefinedPlaceholder?: string;
  /** 是否启用 HTML 转义，默认 false */
  escapeHtml?: boolean;
}

/**
 * 模板上下文——传递给模板引擎的变量和辅助函数。
 */
export interface TemplateContext {
  /** 模板变量 */
  [key: string]: unknown;
}
