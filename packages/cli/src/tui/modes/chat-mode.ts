/**
 * tui/modes/chat-mode.ts — Chat 模式
 *
 * 对话模式：意图分类（conversation vs task），conversation 纯 LLM 流式输出，
 * task 走完整 pipeline（Agent emoji + 工具调用 + 任务树）。
 *
 * @module tui/modes/chat-mode
 * @since v3 — CLI TUI 全栈重构
 */

import type { AgentType, LlmMessage, ICortexApi } from "@cortex/shared";
import type { TuiEvent, TuiHooks, LlmStreamBridge } from "../types.js";
import { queryLoop } from "../query-loop.js";

/**
 * Chat 模式执行器。
 *
 * 特色：
 * - 意图分类保留（conversation → 纯流式输出，task → 完整 pipeline）
 * - @agent 切换 → persona-header 显示角色转场
 * - 支持中途确认门弹出（run_shell 等高危操作）
 */
export async function* chatMode(
  input: string,
  bridge: LlmStreamBridge & Pick<ICortexApi, "chat" | "submitTask" | "executeAll">,
  agent: AgentType,
  history?: LlmMessage[],
): AsyncGenerator<TuiEvent, string, void> {
  const hooks: TuiHooks = {
    onPreToolUse: async (event) => {
      // Chat 模式：高危操作放行进入 Toolkit 管道，由 ConfirmGate 做用户确认
      // （Toolkit.setGate() 已在 bootstrap 阶段注入，L2/L3 操作自动弹出确认）
      if (event.tool === "run_shell" || event.tool === "delete_file") {
        return "allow";
      }
      return "allow";
    },
    onChunk: (_event) => {
      // Chat 模式下 LLM chunk 由 TUI 渲染层处理
    },
  };

  return yield* queryLoop(input, bridge, "chat", agent, hooks, history);
}
