// ============================================================================
// @cortex/skill-kit — Core Type Definitions
//
// All interfaces, types, and error classes that form the contract of the
// skill system.
// ============================================================================

// ─── Execution Context & Result ────────────────────────────────────────────

/**
 * 技能执行上下文。
 * 包含技能执行时所需的全部环境信息。
 */
export interface ExecutionContext {
  /** 触发本次执行的 Agent 类型 */
  agentType: string;

  /** 触发标签列表 */
  triggerTags: string[];

  /** Agent 的 system prompt（可注入） */
  systemPrompt: string;

  /** 任务描述（由 MetaAgent 规划生成） */
  taskDescription: string;

  /** 工作目录 */
  cwd: string;

  /** 已收集的上下文文件列表 */
  contextFiles: string[];

  /** 可选的额外参数（由调用方传递） */
  params?: Record<string, unknown>;
}

/**
 * 技能执行结果。
 */
export interface ExecutionResult {
  /** 是否成功 */
  success: boolean;

  /** 执行后的输出数据 */
  output: unknown;

  /** 注入到 Agent system prompt 的文本（如有） */
  injectedContext?: string;

  /** 执行耗时（ms） */
  durationMs: number;

  /** 错误信息（失败时） */
  error?: string;

  /** 执行日志（调试用） */
  logs: string[];
}

// ─── SkillDefinition — 核心契约 ────────────────────────────────────────────

/**
 * 技能定义 —— 一个可执行技能的所有元数据和行为。
 *
 * 这是 @cortex/skill-kit 的核心接口，替代 JSON-only 的 SkillTemplate，
 * 支持以代码形式定义可执行技能。
 */
export interface SkillDefinition {
  // ─── 元数据 ─────────────────────────────────────

  /** 唯一标识，格式: `skill-{namespace}-{name}` */
  readonly id: string;

  /** 人类可读名称 */
  readonly name: string;

  /** 详细描述 */
  readonly description: string;

  /** Agent 类型匹配列表 */
  readonly agentTypes: string[];

  /** 触发标签 */
  readonly triggerTags: string[];

  /** 技能版本（语义化版本） */
  readonly version: string;

  /** 作者 */
  readonly author?: string;

  // ─── 输入规范 ───────────────────────────────────

  /** 期望的输入参数 schema（JSON Schema 或 Zod Schema 描述） */
  readonly inputSchema?: Record<string, unknown>;

  /** 期望的上下文文件 glob 模式 */
  readonly requiredContextFiles?: string[];

  // ─── 生命周期钩子 ───────────────────────────────

  /** 技能初始化（在注册时调用，仅一次） */
  onInit?(): Promise<void>;

  /** 技能销毁（在移除时调用） */
  onDestroy?(): Promise<void>;

  // ─── 核心行为 ───────────────────────────────────

  /**
   * 校验输入是否合法。
   * 默认基于 inputSchema 校验，可重写。
   */
  validateInput?(input: unknown): Promise<boolean>;

  /**
   * 在匹配后被调用，生成要注入到 Agent system prompt 的上下文。
   * 返回 null 表示无需注入。
   */
  buildContext?(ctx: ExecutionContext): Promise<string | null>;

  /**
   * 执行技能主体逻辑。
   * 这是技能的核心行为。
   */
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;
}

// ─── SkillExecutor — 单个技能的执行接口 ────────────────────────────────────

/**
 * 技能执行器 —— 负责执行单个 SkillDefinition 实例。
 *
 * 与 Executor 类的区别：
 * - SkillExecutor 是**单个技能**的执行接口
 * - Executor 类是**编排层**，管理多个技能的执行生命周期
 */
export interface SkillExecutor {
  /** 此执行器关联的技能 ID */
  readonly skillId: string;

  /**
   * 执行技能。
   *
   * 实现应处理以下生命周期：
   * 1. 校验输入（调用 skill.validateInput 或默认校验）
   * 2. 调用 skill.execute
   * 3. 捕获异常并格式化为 ExecutionResult
   * 4. 记录执行日志和耗时
   */
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;

  /**
   * 构建注入上下文（用于 MetaAgent 规划阶段）。
   * 这是 execute 的轻量版本，仅生成注入文本，不执行技能主体。
   */
  buildInjection(ctx: ExecutionContext): Promise<string | null>;

  /**
   * 校验输入是否合法。
   */
  validate(input: unknown): Promise<boolean>;
}

// ─── PromptTemplate — 提示模板 ─────────────────────────────────────────────

/**
 * 模板变量。
 * 键为变量名，值为要替换的值。
 */
export interface TemplateVariables {
  [key: string]: string | number | boolean | string[];
}

/**
 * 提示模板 —— 将结构化数据渲染为自然语言提示文本。
 *
 * 支持 {{variable}} 语法进行变量插值。
 * 支持 {{#each list}}...{{/each}} 块级迭代。
 */
export interface PromptTemplate {
  /** 模板唯一标识 */
  readonly id: string;

  /** 模板描述 */
  readonly description: string;

  /** 模板内容 */
  readonly template: string;

  /**
   * 使用给定变量渲染模板。
   * @param variables - 要注入的变量
   * @returns 渲染后的文本
   * @throws {TemplateRenderError} 当缺少必需变量或语法错误时
   */
  render(variables: TemplateVariables): string;

  /**
   * 列出模板中声明的所有变量名（不含块级标签）。
   */
  listVariables(): string[];

  /**
   * 校验给定变量集是否满足模板要求。
   */
  validateVariables(variables: TemplateVariables): boolean;
}

/**
 * 模板渲染错误。
 */
export class TemplateRenderError extends Error {
  constructor(
    message: string,
    public readonly templateId: string,
    public readonly missingVariables?: string[],
  ) {
    super(message);
    this.name = 'TemplateRenderError';
  }
}

// ─── Validation Types ──────────────────────────────────────────────────────

/** 校验级别 */
export type ValidationLevel = 'error' | 'warn' | 'info';

/** 校验结果条目 */
export interface ValidationEntry {
  /** 级别 */
  level: ValidationLevel;

  /** 校验码（用于去重和文档） */
  code: string;

  /** 人类可读消息 */
  message: string;

  /** 关联的技能 ID */
  skillId: string;

  /** 关联的字段路径（如 'triggerTags'） */
  path?: string;

  /** 建议修复方案 */
  suggestion?: string;
}

/** 校验结果 */
export interface ValidationResult {
  /** 是否通过（无 error 级别条目） */
  valid: boolean;

  /** 所有校验条目 */
  entries: ValidationEntry[];

  /** 错误数量 */
  errorCount: number;

  /** 警告数量 */
  warnCount: number;
}

/** 校验规则 —— 单个可组合的校验逻辑 */
export interface ValidationRule {
  /** 规则唯一标识 */
  id: string;

  /** 规则描述 */
  description: string;

  /** 执行校验 */
  validate(skill: SkillDefinition): ValidationEntry[];
}

// ─── Loader Types ──────────────────────────────────────────────────────────

/** 加载结果 */
export interface LoadResult {
  /** 成功加载的技能 */
  skills: SkillDefinition[];

  /** 加载失败的文件及其错误 */
  errors: { file: string; error: string }[];

  /** 加载耗时（ms） */
  durationMs: number;
}

/** 源读取器 —— 读取原始技能数据 */
export interface SourceReader {
  read(path: string): Promise<string | Record<string, unknown>>;
}

/** 技能解析器 —— 将原始数据解析为 SkillDefinition */
export interface SkillParser {
  parse(data: string | Record<string, unknown>): SkillDefinition | SkillDefinition[];
}

// ─── Cache Types ───────────────────────────────────────────────────────────

/** 缓存策略 */
export type CacheStrategy = 'lru' | 'fifo' | 'ttl';

/** 缓存配置 */
export interface CacheOptions {
  /** 最大条目数（默认 100） */
  maxSize?: number;

  /** 缓存策略（默认 'lru'） */
  strategy?: CacheStrategy;

  /** TTL 毫秒（仅 strategy='ttl' 时生效，默认 5 分钟） */
  ttlMs?: number;
}

/** 缓存统计 */
export interface CacheStats {
  definitions: number;
  validations: number;
  renders: number;
  maxSize: number;
}

// ─── Executor Types ────────────────────────────────────────────────────────

/** Executor 事件 */
export type ExecutorEvent =
  | 'skill:loaded'
  | 'skill:validated'
  | 'skill:executing'
  | 'skill:executed'
  | 'skill:failed'
  | 'cache:hit'
  | 'cache:miss';

/** 事件监听器 */
export type ExecutorEventListener = (event: ExecutorEvent, data: unknown) => void;

/** Loader 配置 */
export interface LoaderOptions {
  /** 是否递归搜索子目录 */
  recursive?: boolean;

  /** 要包含的文件 glob 模式 */
  includePatterns?: string[];

  /** 要排除的 glob 模式 */
  excludePatterns?: string[];

  /** 自定义文件扩展名映射到加载策略 */
  extensions?: Record<string, 'module' | 'json'>;
}

/** Validator 配置选项 */
export interface ValidatorOptions {
  /** 要忽略的规则 ID 列表 */
  ignoredRules?: string[];

  /** 严格模式：warn 级别也视为不通过 */
  strictMode?: boolean;
}

/** Executor 配置 */
export interface ExecutorOptions {
  /** Loader 配置 */
  loader?: LoaderOptions;

  /** Validator 配置 */
  validator?: ValidatorOptions;

  /** Cache 配置 */
  cache?: CacheOptions;

  /** 是否在技能执行前自动校验 */
  autoValidate?: boolean;

  /** 是否启用缓存 */
  enableCache?: boolean;
}
