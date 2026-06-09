/**
 * tui/modes/talk-mode.ts — Talk 模式（昔涟独立人格）
 *
 * 纯流式对话，不显示工具/任务。昔涟独立人格——私密、轻松、
 * 有独立记忆库（@cortex/cyrene-memory.db）。
 *
 * @module tui/modes/talk-mode
 * @since v3 — CLI TUI 全栈重构
 */

import type { AgentType, LlmMessage, ICortexApi } from "@cortex/shared";
import type { TuiEvent, TuiHooks, LlmStreamBridge } from "../types.js";
import { queryLoop } from "../query-loop.js";

/**
 * Talk 模式执行器。
 *
 * 昔涟独立人格：
 * - 纯流式对话，不显示工具/任务
 * - persona-header 固定显示昔涟身份
 * - .with @纳西妲 → 三人对话模式
 */
export async function* talkMode(
  input: string,
  bridge: LlmStreamBridge & Pick<ICortexApi, "chat" | "submitTask" | "executeAll">,
  history?: LlmMessage[],
): AsyncGenerator<TuiEvent, string, void> {
  const hooks: TuiHooks = {
    // Talk 模式：禁止工具调用
    onPreToolUse: async (_event) => {
      return "deny"; // 闲聊不执行工具
    },
    onChunk: (_event) => {
      // Talk 模式下 LLM 流式输出由渲染层逐字显示
    },
  };

  return yield* queryLoop(input, bridge, "talk", "cyrene" as AgentType, hooks, history);
}
