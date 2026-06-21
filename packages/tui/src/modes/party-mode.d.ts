/**
 * tui/modes/party-mode.ts — Party 模式（群聊）
 *
 * 多 Agent 群聊——自由 @ 点名 + 全员抢麦。
 * 基于 multiSpeakerLoop 共用底座。
 *
 * @module tui/modes/party-mode
 * @since v3 — CLI TUI 全栈重构
 */
import type { LlmMessage, ICortexApi } from "@cortex/shared";
import { AgentType } from "@cortex/shared";
import type { TuiEvent, LlmStreamBridge } from "../types.js";
/**
 * 从输入中解析 @ 提及。
 * 支持 @中文名 和 @英文type。
 * 返回匹配到的 AgentType 数组（去重）。
 */
export declare function parseMentions(input: string): AgentType[];
/** Party 模式默认参与者——butler（昔涟）+ analysis（纳西妲） */
export declare const DEFAULT_PARTY: AgentType[];
/**
 * Party 模式执行器。
 *
 * 群聊特色：
 * - @ 点名：（@纳西妲 @阿贝多）仅点名 Agent 发言
 * - 无 @：所有参与者自由发言
 * - 基于 multiSpeakerLoop 共用底座
 */
export declare function partyMode(input: string, bridge: LlmStreamBridge & Pick<ICortexApi, "chat" | "submitTask" | "executeAll">, agents: AgentType[], history?: LlmMessage[]): AsyncGenerator<TuiEvent, string, void>;
//# sourceMappingURL=party-mode.d.ts.map