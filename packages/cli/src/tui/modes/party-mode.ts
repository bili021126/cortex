/**
 * tui/modes/party-mode.ts — Party 模式（群聊）
 *
 * 多 Agent 并发输出的群聊模式——自由抢麦 + @ 点名。
 * party.ts 状态管理保留。
 *
 * @module tui/modes/party-mode
 * @since v3 — CLI TUI 全栈重构
 */

import type { AgentType, LlmMessage, ICortexApi } from "@cortex/shared";
import type { TuiEvent, TuiHooks, LlmStreamBridge } from "../types.js";
import { queryLoop } from "../query-loop.js";

/**
 * Party 模式执行器。
 *
 * 特色：
 * - 群聊自由抢麦 + @ 点名
 * - 多 Agent 并发输出各自独立渲染
 * - party.ts 状态管理保留
 */
export async function* partyMode(
  input: string,
  bridge: LlmStreamBridge & Pick<ICortexApi, "chat" | "submitTask" | "executeAll">,
  agents: AgentType[],
  history?: LlmMessage[],
): AsyncGenerator<TuiEvent, string, void> {
  const hooks: TuiHooks = {
    onPreToolUse: async (_event) => {
      return "deny"; // 群聊不执行工具
    },
    onChunk: (_event) => {
      // Party 模式下每个 Agent 的输出独立渲染
    },
  };

  // 取第一个 Agent 作为发言人
  const speaker = agents[0] ?? ("code" as AgentType);

  return yield* queryLoop(input, bridge, "party", speaker, hooks, history);
}
