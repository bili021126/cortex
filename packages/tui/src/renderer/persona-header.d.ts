/**
 * tui/renderer/persona-header.ts — 角色头渲染器
 *
 * 显示当前 Agent 的 emoji + 名字 + 签名。模式切换时播放
 * 角色转场动画。
 *
 * @module tui/renderer/persona-header
 * @since v3 — CLI TUI 全栈重构
 */
import { type AgentType } from "@cortex/shared";
import type { ReplMode } from "../types.js";
/**
 * 渲染多人角色头——群聊 / 三人 talk 模式。
 *
 * 格式：
 * ```
 * ═══════════════════════════════════════════════
 * 🌸 昔涟 + 🌿 纳西妲              👥 三人
 * ═══════════════════════════════════════════════
 * ```
 */
export declare function renderMultiPersonaHeader(agents: AgentType[], modeLabel: string): void;
/**
 * 渲染角色头。
 *
 * 格式：
 * ```
 * ═══════════════════════════════════════════════
 * 🧪 阿贝多 [code] — 首席炼金术士    💬 对话
 * ═══════════════════════════════════════════════
 * ```
 */
export declare function renderPersonaHeader(agent: AgentType, mode: ReplMode): void;
/**
 * 角色转场动画——简要提示旧角色退场、新角色登场。
 */
export declare function renderAgentTransition(from: AgentType, to: AgentType): void;
//# sourceMappingURL=persona-header.d.ts.map