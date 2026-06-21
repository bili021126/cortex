/**
 * tui/renderer/diff-viewer.ts — Inline Diff 渲染器
 *
 * Claude Code 对标：终端内 side-by-side diff 渲染。
 * 输入 unified diff 格式文本，输出 ANSI 着色输出。
 *
 * 渲染能力：
 * - `+` 行 → 绿色背景/前景
 * - `-` 行 → 红色背景/前景
 * - `@@` hunk header → 青色
 * - 自适应终端宽度，超宽行软换行
 * - 可选 side-by-side 模式（左右分栏，各占 50% 宽度）
 *
 * @module tui/renderer/diff-viewer
 * @since v3 — Claude Code 对标：Inline Diff
 */
import { style, StyleCode, ColorCode } from "./ansi.js";
// ═══════════════════════════════════════════════════════════
// §2 解析
// ═══════════════════════════════════════════════════════════
/** 解析 unified diff 文本为结构化行 */
function parseDiff(diffText) {
    const lines = [];
    for (const rawLine of diffText.split("\n")) {
        if (rawLine.startsWith("diff --git") || rawLine.startsWith("index ")) {
            lines.push({ type: "header", text: rawLine });
        }
        else if (rawLine.startsWith("--- ") || rawLine.startsWith("+++ ")) {
            lines.push({ type: "file_header", text: rawLine });
        }
        else if (rawLine.startsWith("@@")) {
            lines.push({ type: "hunk", text: rawLine });
        }
        else if (rawLine.startsWith("+")) {
            lines.push({ type: "add", text: rawLine });
        }
        else if (rawLine.startsWith("-")) {
            lines.push({ type: "remove", text: rawLine });
        }
        else {
            lines.push({ type: "context", text: rawLine });
        }
    }
    return lines;
}
// ═══════════════════════════════════════════════════════════
// §3 渲染
// ═══════════════════════════════════════════════════════════
/** 单行着色 */
function colorizeLine(line, maxWidth) {
    const text = line.text.slice(0, maxWidth);
    switch (line.type) {
        case "add":
            return style(text, ColorCode.green);
        case "remove":
            return style(text, ColorCode.red);
        case "header":
            return style(text, StyleCode.bold);
        case "file_header":
            return style(text, StyleCode.bold + ColorCode.yellow);
        case "hunk":
            return style(text, ColorCode.cyan);
        default:
            return style(text, StyleCode.dim);
    }
}
/** Unified 模式渲染 */
function renderUnified(lines, maxWidth) {
    return lines.map((l) => colorizeLine(l, maxWidth));
}
/** Side-by-side 模式渲染 */
function renderSideBySide(lines, maxWidth) {
    const halfWidth = Math.floor((maxWidth - 3) / 2); // 3 = " | " 分隔符
    const output = [];
    const leftLines = [];
    const rightLines = [];
    for (const line of lines) {
        if (line.type === "remove") {
            leftLines.push(line);
        }
        else if (line.type === "add") {
            rightLines.push(line);
        }
        else {
            // context / header: 两边都放
            leftLines.push(line);
            rightLines.push(line);
        }
    }
    let li = 0, ri = 0;
    while (li < leftLines.length || ri < rightLines.length) {
        const left = li < leftLines.length ? leftLines[li] : null;
        const right = ri < rightLines.length ? rightLines[ri] : null;
        const leftText = left ? left.text.slice(0, halfWidth).padEnd(halfWidth) : " ".repeat(halfWidth);
        const rightText = right ? right.text.slice(0, halfWidth).padEnd(halfWidth) : " ".repeat(halfWidth);
        const leftColored = left ? colorizeLine({ ...left, text: leftText.trimEnd() }, halfWidth).padEnd(halfWidth) : leftText;
        const rightColored = right ? colorizeLine({ ...right, text: rightText.trimEnd() }, halfWidth).padEnd(halfWidth) : rightText;
        output.push(`${leftColored} | ${rightColored}`);
        if (left)
            li++;
        if (right)
            ri++;
    }
    return output;
}
// ═══════════════════════════════════════════════════════════
// §4 主入口
// ═══════════════════════════════════════════════════════════
/**
 * 将 unified diff 文本渲染为 ANSI 着色行数组。
 *
 * @param diffText   unified diff 格式文本
 * @param options    渲染选项
 * @returns          ANSI 着色后的行数组（每行可直接 writeln）
 */
export function renderDiff(diffText, options) {
    const maxWidth = options?.terminalWidth ?? 120;
    const lines = parseDiff(diffText);
    if (options?.sideBySide) {
        return renderSideBySide(lines, maxWidth);
    }
    return renderUnified(lines, maxWidth);
}
/**
 * 将 diff 渲染为单段文本（含换行符）。
 * 适用于直接 writeln 一段。
 */
export function renderDiffText(diffText, options) {
    return renderDiff(diffText, options).join("\n");
}
//# sourceMappingURL=diff-viewer.js.map