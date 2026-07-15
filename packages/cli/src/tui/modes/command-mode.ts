/**
 * tui/modes/command-mode.ts — Command 模式
 *
 * 保留现有 CommandRegistry.dispatch，不经过 queryLoop。
 * 命令输出走 fmt.formatSuccess/formatError。
 *
 * @module tui/modes/command-mode
 * @since v3 — CLI TUI 全栈重构
 */

import type { ICommandResult } from "@cortex/shared";

/**
 * Command 模式处理器——纯命令分发，不经过 LLM。
 *
 * @param dispatchFn 命令分发函数（ICommandDispatcher.dispatch）
 * @param args 命令参数
 * @returns 命令执行结果字符串
 */
export async function commandMode(
  dispatchFn: (args: string[]) => Promise<ICommandResult>,
  args: string[],
): Promise<string> {
  const result = await dispatchFn(args);

  if (result.code === 0) {
    return result.output || "OK";
  }

  return `✗ ${result.output || "命令执行失败"}`;
}
