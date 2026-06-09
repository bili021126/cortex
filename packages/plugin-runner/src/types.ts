/**
 * @cortex/plugin-runner — 类型定义模块
 *
 * 定义所有公开接口和类型，零业务逻辑。
 * 被所有其他模块依赖。
 */

// ── 核心生命周期接口 ──

/**
 * Plugin —— 二级插件的生命周期接口。
 *
 * 生命周期顺序：constructor → init() → [execute()*] → destroy()
 *
 * - init(config):   注入配置、初始化内部状态（数据库连接、文件句柄等）
 * - execute(ctx):   执行插件核心逻辑，结果通过 ExecuteContext.output 传递
 * - destroy():      优雅清理资源（关闭连接、释放锁、清除临时文件）
 *
 * 所有生命周期方法均返回 Promise<void>，保证异步执行的统一契约。
 *
 * @template TConfig  — 插件配置类型（执行 init 前由 PluginValidator 校验）
 */
export interface Plugin<TConfig = PluginConfig> {
  /** 插件唯一名称（用于 Registry 查找和依赖声明） */
  readonly name: string;

  /** 插件语义版本号（遵循 semver） */
  readonly version: string;

  /** 短描述（≤ 80 字符，用于 registry list 展示） */
  readonly description: string;

  /** 依赖的二级插件名称列表（registry 按此解析执行顺序） */
  readonly dependencies: string[];

  /** 插件标签（用于 findByTag 分类检索） */
  readonly tags: string[];

  /** 支持的钩子声明（PluginRunner 据此决定是否调用对应钩子） */
  readonly hooks: PluginHooks;

  /** 初始化——注入配置，准备运行时状态 */
  init(config: TConfig): Promise<void>;

  /** 执行核心逻辑 */
  execute(context: ExecuteContext): Promise<void>;

  /** 清理——释放资源 */
  destroy(): Promise<void>;
}

// ── 元数据与钩子 ──

/**
 * PluginMeta —— 插件注册时的元信息。
 * 用于 registry list / discover 返回，无需加载完整插件实例。
 */
export interface PluginMeta {
  /** 插件名称 */
  name: string;
  /** 版本 */
  version: string;
  /** 描述 */
  description: string;
  /** 标签 */
  tags: string[];
  /** 依赖列表 */
  dependencies: string[];
  /** 钩子声明 */
  hooks: PluginHooks;
  /** 插件文件路径（从文件发现时有值） */
  filePath?: string;
}

/**
 * PluginHooks —— 插件支持的生命周期钩子。
 * PluginRunner 根据此声明选择性地调用对应生命周期方法。
 *
 * 所有字段可选——插件只实现自己需要的钩子。
 */
export interface PluginHooks {
  /** 执行前钩子 */
  beforeExecute?: boolean;
  /** 执行后钩子 */
  afterExecute?: boolean;
  /** 错误处理钩子 */
  onError?: boolean;
  /** 资源清理钩子 */
  onCleanup?: boolean;
}

// ── 执行上下文与结果 ──

/**
 * ExecuteContext —— execute() 时注入的运行时上下文。
 *
 * 插件的 execute() 返回 Promise<void>，执行结果通过 output
 * 字段传递，由 PluginRunner 在 execute 完成后读取并构造成 PluginResult。
 */
export interface ExecuteContext {
  /** 任务载荷（由调用方传入） */
  payload: unknown;

  /** 已初始化的依赖插件映射（按 name → Plugin） */
  deps: Map<string, Plugin>;

  /** 运行时的临时工作目录（PluginRunner 分配，destroy 时清理） */
  workDir: string;

  /** 超时时间 ms（覆盖默认值） */
  timeoutMs?: number;

  /** 中止信号（外部可触发） */
  signal?: AbortSignal;

  /** 执行产出 —— 插件通过此字段传递执行结果，PluginRunner 读取后构造成 PluginResult.output */
  output?: unknown;
}

/**
 * PluginResult —— 执行结果（由 PluginRunner 构造）。
 *
 * Plugin 接口的 execute() 返回 Promise<void>，不直接返回结果。
 * PluginRunner 在 execute 执行完毕后，通过 ExecuteContext.output
 * 和其他运行时信息自行构造 PluginResult。
 */
export interface PluginResult<T = unknown> {
  /** 执行是否成功 */
  success: boolean;

  /** 成功时的产出 */
  output?: T;

  /** 失败时的错误信息 */
  error?: string;

  /** 执行耗时 ms */
  durationMs: number;

  /** 插件内发出的事件列表（桥接到 PipelineObserver） */
  events?: PluginEvent[];
}

/**
 * PluginEvent —— 二级插件的内部事件。
 * PluginRunner 将这些事件桥接到引擎的 PipelineObserver 事件总线。
 */
export interface PluginEvent {
  /** 事件类型 */
  type: string;
  /** 事件载荷 */
  payload: unknown;
  /** 事件时间戳 */
  timestamp: number;
}

// ── 配置与 Schema ──

/**
 * PluginConfig —— 插件的通用配置接口。
 * 具体插件可继承此接口扩展自定义配置字段。
 */
export interface PluginConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 执行超时 ms（默认 30000） */
  timeout?: number;
  /** 插件级环境变量覆盖 */
  env?: Record<string, string>;
  /** 自定义配置（按插件类型解构） */
  [key: string]: unknown;
}

/**
 * PluginSchema —— 插件校验 schema 定义。
 * 每个插件类型在注册时关联一个 schema，用于校验配置和输入参数。
 *
 * @template _T — schema 对应的配置类型
 */
export interface PluginSchema<_T = Record<string, unknown>> {
  /** schema 名称（对应插件类型） */
  name: string;
  /** 配置校验函数（返回错误列表，空数组=通过） */
  validateConfig(config: unknown): string[];
  /** 输入参数校验函数（可选） */
  validateInput?(input: unknown): string[];
  /** 输出结果校验函数（可选） */
  validateOutput?(output: unknown): string[];
}

// ── 运行时状态 ──

/**
 * PluginStatus —— 插件的运行时健康状态。
 */
export interface PluginStatus {
  /** 插件名称 */
  name: string;
  /** 生命周期阶段 */
  phase: "created" | "initialized" | "running" | "destroyed" | "error";
  /** 最后执行时间戳 */
  lastExecutedAt?: number;
  /** 累计执行次数 */
  executionCount: number;
  /** 累计失败次数 */
  failureCount: number;
  /** 最后错误信息 */
  lastError?: string;
  /** 是否健康 */
  healthy: boolean;
}

// ── 批量执行报告 ──

/**
 * ExecutionReport —— executeAll() 的批量执行报告。
 */
export interface ExecutionReport {
  /** 总执行数 */
  total: number;
  /** 成功数 */
  succeeded: number;
  /** 失败数 */
  failed: number;
  /** 单个插件结果 */
  results: Map<string, PluginResult>;
  /** 总耗时 ms */
  totalDurationMs: number;
}

// ── 校验结果 ──

/**
 * ValidationResult —— Schema 校验结果。
 */
export interface ValidationResult {
  /** 校验是否通过 */
  valid: boolean;
  /** 错误信息列表 */
  errors: string[];
}
