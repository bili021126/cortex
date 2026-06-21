/**
 * tui/modes/talk-mode.ts — Talk 模式（昔涟独立人格 + 三人亲密）
 *
 * 纯流式对话，不显示工具/任务。
 * 单 Agent：昔涟独立人格——加载 .cortex/persona-talk.txt。
 * 三人：昔涟 + 纳西妲 共存，共享对话历史，各自独立 persona。
 *
 * v2.7: + 昔涟记忆读写（talkMemoryStore），每次对话自动加载最近记忆并保存本次交换。
 *
 * @module tui/modes/talk-mode
 * @since v3 — CLI TUI 全栈重构
 */
import { type AgentType as AgentTypeEnum, type LlmMessage, type ICortexApi } from "@cortex/shared";
import type { TuiEvent, LlmStreamBridge } from "../types.js";
/** Talk 桥接——扩展记忆读写能力 */
type TalkBridge = LlmStreamBridge & Pick<ICortexApi, "chat" | "submitTask" | "executeAll" | "readTalkMemory" | "writeTalkMemory" | "ensureTalkMemory">;
/**
 * Talk 模式执行器——单 Agent（昔涟默认）。
 *
 * 昔涟专属：加载最近 5 条记忆注入上下文，回复后保存本次交换。
 */
export declare function talkMode(input: string, bridge: TalkBridge, agent: AgentTypeEnum, history?: LlmMessage[]): AsyncGenerator<TuiEvent, string, void>;
/**
 * 三人亲密模式——昔涟 + 纳西妲 同场。
 *
 * 共享对话历史，各自加载完整 persona（昔涟 → .cortex/persona-talk.txt，
 * 纳西妲 → nahida-persona.txt），按序流式发言。
 *
 * v2.7: + 昔涟记忆上下文注入 + 保存。
 */
export declare function talkTrioMode(input: string, bridge: TalkBridge, history?: LlmMessage[]): AsyncGenerator<TuiEvent, string, void>;
export {};
//# sourceMappingURL=talk-mode.d.ts.map