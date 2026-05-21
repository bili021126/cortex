/**
 * constants.ts —— @cortex/cli 统一常量定义。
 *
 * 所有魔法数字、版本字符串、默认值集中于此。
 * 禁止在其他模块直接书写字面量——违反者：配置漂移。
 *
 * @module constants
 * @since v0.2.1 — Core-1 硬编码抽离
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

// ════════════════════════════════════════════════════════
// 输出格式
// ════════════════════════════════════════════════════════

export const OUTPUT_FORMATS = ["text", "json", "color"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const DEFAULT_OUTPUT_FORMAT: OutputFormat = "text";
