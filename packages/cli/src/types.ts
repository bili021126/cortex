/**
 * types.ts — CLI 领域类型定义
 *
 * 定义 CLI 专用的命令注册、输出格式、交互模式类型，
 * 不依赖 engine 层的具体类型，保持 CLI 框架层的通用性。
 */

// ─── 输出格式 ──────────────────────────────────────────

export type OutputFormat = "text" | "json" | "color";

// ─── 交互模式 ──────────────────────────────────────────

export type InteractionMode = "single-shot" | "repl" | "daemon";

// ─── 全局选项 ──────────────────────────────────────────

export interface GlobalOptions {
  format?: OutputFormat;
  quiet?: boolean;
  verbose?: boolean;
  config?: string;
  noColor?: boolean;
  timeout?: number;
  help?: boolean;
  version?: boolean;
}

// ─── 命令定义 ──────────────────────────────────────────

export interface CommandDefinition {
  /** 命令名（如 "run", "agent", "memory"） */
  name: string;
  /** 子命令映射（如 { list, inspect, spawn, destroy }） */
  subcommands?: Record<string, SubcommandDefinition>;
  /** 命令描述（用于 help） */
  description: string;
  /** 短别名（如 "r" → "run"） */
  alias?: string;
  /** 处理器 */
  handler: CommandHandler;
}

export interface SubcommandDefinition {
  description: string;
  usage: string;
  handler: CommandHandler;
}

/** 命令处理器签名 */
export type CommandHandler = (
  args: string[],
  options: Record<string, unknown>,
  context: CommandContext,
) => Promise<CommandResult>;

/** 命令执行上下文 */
export interface CommandContext {
  /** 输出格式 */
  format: OutputFormat;
  /** 是否静默模式 */
  quiet: boolean;
  /** 是否详细模式 */
  verbose: boolean;
  /** 配置路径 */
  configPath?: string;
  /** 命令行参数的原始键值对 */
  rawOptions: Record<string, unknown>;
}

/** 命令执行结果 */
export interface CommandResult {
  /** 成功/失败 */
  success: boolean;
  /** 人类可读输出 */
  output?: string;
  /** 结构化数据（用于 JSON 输出） */
  data?: unknown;
  /** 错误信息 */
  error?: string;
  /** 退出码 */
  exitCode: number;
}

// ─── 引擎桥接状态 ──────────────────────────────────────

export interface EngineComponents {
  scheduler?: unknown;
  memoryStore?: unknown;
  agentPool?: unknown;
  taskBoard?: unknown;
  pipelineObserver?: unknown;
  confirmGate?: unknown;
  cliAdapter?: unknown;
  initialized: boolean;
}
