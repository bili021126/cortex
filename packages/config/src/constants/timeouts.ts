/**
 * @cortex/config — 超时常量
 *
 * @module constants/timeouts
 * @layer root
 */

/** 工具调用最大轮次（TUI 对话模式） */
export const DEFAULT_MAX_TOOL_ROUNDS = 20;

/** 任务执行默认超时（秒） */
export const DEFAULT_TASK_TIMEOUT_SEC = 300;

/** 命令分发超时（秒） */
export const DEFAULT_COMMAND_TIMEOUT_SEC = 60;

/** 输出格式默认值 */
export const DEFAULT_OUTPUT_FORMAT = "text" as const;

/** 工具执行超时（毫秒）——configuration-drift / monorepo-analyzer 等工具的最长执行时间 */
export const TOOL_EXECUTION_TIMEOUT_MS = 300_000;
