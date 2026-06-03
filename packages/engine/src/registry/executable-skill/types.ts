// ============================================================
// 🌿 Cortex 技能注册表 — 核心类型定义层
// 设计：纳西妲 | 实现：阿贝多
//
// @moved-from projects/solo-flight/src/registry/types.ts
// ============================================================

// ============ 技能标识 ============

/** 技能唯一标识符（品牌类型） */
export type SkillId = string & { readonly __brand: 'SkillId' };

/** 技能版本号，遵循 semver */
export type SkillVersion = string & { readonly __brand: 'SkillVersion' };

// ============ 技能分类 ============

/** 技能分类枚举 */
export enum SkillCategory {
  /** 数据获取与处理 */
  DATA = 'data',
  /** 文本生成与 NLP */
  NLP = 'nlp',
  /** 工具调用（API/Shell/FS） */
  TOOL = 'tool',
  /** 认知推理 */
  REASONING = 'reasoning',
  /** 记忆存储 */
  MEMORY = 'memory',
  /** 通信交互 */
  COMMUNICATION = 'communication',
  /** 系统内置 */
  SYSTEM = 'system',
}

// ============ 技能元信息 ============

/** 技能元信息（注册时所需的描述数据） */
export interface SkillMeta {
  /** 唯一标识 */
  id: SkillId;
  /** 展示名称 */
  name: string;
  /** 语义化版本 */
  version: SkillVersion;
  /** 描述 */
  description: string;
  /** 作者/维护者 */
  author?: string;
  /** 标签分类 */
  tags: string[];
  /** 依赖的其他技能 ID 列表 */
  dependencies: SkillId[];
  /** 支持的操作系统 (optional runtime filter) */
  platforms?: Array<'node' | 'browser' | 'worker'>;
  /** 技能类别 */
  category: SkillCategory;
  /** 自定义元数据扩展 */
  extensions?: Record<string, unknown>;
  /** 入口文件路径（用于 CLI 安装/加载） */
  entry?: string;
}

// ============ 技能输入/输出 ============

/** 技能输入 */
export interface SkillInput<T = unknown> {
  /** 实际参数 */
  params: T;
  /** 调用方跟踪 ID */
  traceId?: string;
  /** 超时控制 (ms) */
  timeout?: number;
  /** 信号量控制 */
  signal?: AbortSignal;
}

/** 技能执行元信息 */
export interface ExecutionMeta {
  /** 执行耗时 (ms) */
  duration: number;
  /** 实际使用的技能版本 */
  version: SkillVersion;
  /** 重试次数 */
  retryCount: number;
  /** 时间戳 */
  timestamp: number;
}

/** 技能输出 */
export type SkillResult<T = unknown> =
  | { success: true; data: T; meta?: ExecutionMeta }
  | { success: false; error: SkillError; meta?: ExecutionMeta };

// ============ 技能错误 ============

/** 技能错误 */
export interface SkillError {
  code: SkillErrorCode;
  message: string;
  details?: unknown;
  /** 原始错误（仅在非生产环境暴露） */
  cause?: Error;
}

export enum SkillErrorCode {
  NOT_FOUND = 'SKILL_NOT_FOUND',
  DEPENDENCY_FAILED = 'SKILL_DEPENDENCY_FAILED',
  EXECUTION_FAILED = 'SKILL_EXECUTION_FAILED',
  TIMEOUT = 'SKILL_TIMEOUT',
  VALIDATION_FAILED = 'SKILL_VALIDATION_FAILED',
  UNAUTHORIZED = 'SKILL_UNAUTHORIZED',
  RATE_LIMITED = 'SKILL_RATE_LIMITED',
  INTERNAL_ERROR = 'SKILL_INTERNAL_ERROR',
  CIRCULAR_DEPENDENCY = 'SKILL_CIRCULAR_DEPENDENCY',
}

// ============ 注册过滤器与选项 ============

/** 注册过滤器（用于搜索技能） */
export interface RegistryFilter {
  category?: SkillCategory;
  tags?: string[];
  version?: string;
  search?: string;
}

/** 注册选项 */
export interface RegisterOptions {
  /** 是否覆盖已存在的同名技能 */
  overwrite?: boolean;
  /** 是否延迟实例化（仅注册元信息） */
  lazy?: boolean;
  /** 优先级（值越大越优先） */
  priority?: number;
  /** 执行超时 (ms) */
  defaultTimeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}

// ============ 注册表事件 ============

/** 注册表事件类型 */
export type RegistryEvent =
  | 'beforeRegister'
  | 'afterRegister'
  | 'beforeUnregister'
  | 'afterUnregister'
  | 'beforeExecute'
  | 'afterExecute'
  | 'onError'
  | 'onStartup'
  | 'onShutdown';

/** 注册表事件处理器 */
export type RegistryEventHandler = (payload: unknown) => void | Promise<void>;

// ============ 技能定义接口（实现者视角） ============

/**
 * 技能定义接口——所有技能必须实现
 *
 * @template TInput  输入参数类型
 * @template TOutput 输出结果类型
 */
export interface Skill<TInput = unknown, TOutput = unknown> {
  /** 技能元信息 */
  meta: SkillMeta;

  /** 执行技能 */
  run(context: ExecutionContext): Promise<SkillResult<TOutput>>;

  /** （可选）输入校验 */
  validate?(input: unknown): input is TInput;

  /** （可选）技能初始化（实例化时调用） */
  onInit?(): Promise<void>;

  /** （可选）技能销毁 */
  onDestroy?(): Promise<void>;
}

// ============ 技能执行上下文类型 ============

/** 日志记录器接口 */
export interface Logger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
  debug: (msg: string, ...args: unknown[]) => void;
}

/** 服务容器接口 */
export interface ServiceContainer {
  get<T>(token: string): T;
  register<T>(token: string, instance: T): void;
  has(token: string): boolean;
}

/** 技能执行上下文 */
export interface ExecutionContext {
  /** 技能入参 */
  input: SkillInput;
  /** 运行时服务容器 */
  services: ServiceContainer;
  /** 日志记录器 */
  logger: Logger;
  /** 中止信号 */
  signal: AbortSignal;
  /** 上下文存储（技能间共享数据） */
  store: Map<string, unknown>;
  /** 获取依赖技能的执行结果 */
  getDependencyResult: <T>(skillId: SkillId) => Promise<SkillResult<T>>;
}

// ============ 中间件 ============

/** 中间件上下文 */
export interface MiddlewareContext {
  skill: { meta: SkillMeta };
  input: SkillInput;
  logger: Logger;
  [key: string]: unknown;
}

/** 中间件 next 函数 */
export type NextFunction = () => Promise<void>;

/** 技能中间件 */
export type SkillMiddleware = (
  ctx: MiddlewareContext,
  next: NextFunction
) => Promise<void>;
