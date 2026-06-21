/**
 * tui/renderer/persona-header.ts — 角色头渲染器
 *
 * 显示当前 Agent 的 emoji + 名字 + 签名。模式切换时播放
 * 角色转场动画。
 *
 * @module tui/renderer/persona-header
 * @since v3 — CLI TUI 全栈重构
 */
import { AGENT_DISPLAY_BY_TYPE, AGENT_DISPLAY_FALLBACK } from "@cortex/shared";
import { style, writeln, terminalWidth, StyleCode } from "./ansi.js";
/** 模式标签 */
const MODE_LABELS = {
    command: "⌨ 命令",
    chat: "💬 对话",
    talk: "🗣 闲聊",
    plan: "📋 规划",
    party: "👥 群聊",
};
/** 多人头部标签映射 */
const MULTI_MODE_LABELS = {
    "talk-trio": "👥 三人",
    "party": "👥 群聊",
};
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
export function renderMultiPersonaHeader(agents, modeLabel) {
    const w = Math.min(terminalWidth(), 80);
    const parts = agents.map(a => {
        const d = AGENT_DISPLAY_BY_TYPE[a] ?? AGENT_DISPLAY_FALLBACK;
        return `${d.emoji} ${style(d.name, StyleCode.bold)}`;
    });
    const leftPart = parts.join(` ${style("+", StyleCode.dim)} `);
    const rightPart = MULTI_MODE_LABELS[modeLabel] ?? modeLabel;
    const spacer = " ".repeat(Math.max(1, w - leftPart.length - rightPart.length));
    const sep = style("═".repeat(w), StyleCode.dim);
    writeln(sep);
    writeln(leftPart + spacer + rightPart);
    writeln(sep);
}
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
export function renderPersonaHeader(agent, mode) {
    const w = Math.min(terminalWidth(), 80);
    const display = AGENT_DISPLAY_BY_TYPE[agent] ?? AGENT_DISPLAY_FALLBACK;
    const leftPart = `${display.emoji} ${style(display.name, StyleCode.bold)} ${style(`[${agent}]`, StyleCode.dim)} — ${style(display.signature, StyleCode.dim)}`;
    const rightPart = MODE_LABELS[mode];
    const spacer = " ".repeat(Math.max(1, w - leftPart.length - rightPart.length));
    const sep = style("═".repeat(w), StyleCode.dim);
    writeln(sep);
    writeln(leftPart + spacer + rightPart);
    writeln(sep);
}
/**
 * 角色转场动画——简要提示旧角色退场、新角色登场。
 */
export function renderAgentTransition(from, to) {
    const fromDisplay = AGENT_DISPLAY_BY_TYPE[from] ?? AGENT_DISPLAY_FALLBACK;
    const toDisplay = AGENT_DISPLAY_BY_TYPE[to] ?? AGENT_DISPLAY_FALLBACK;
    writeln(style(`${fromDisplay.emoji} ${fromDisplay.name}`, StyleCode.dim) +
        " → " +
        style(`${toDisplay.emoji} ${toDisplay.name}`, StyleCode.bold) +
        " " + style("角色切换", StyleCode.dim));
}
//# sourceMappingURL=persona-header.js.map