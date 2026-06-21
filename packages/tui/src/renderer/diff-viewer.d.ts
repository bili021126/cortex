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
/** 渲染选项 */
interface DiffOptions {
    /** 终端宽度（字符数），默认 80 */
    terminalWidth?: number;
    /** 是否 side-by-side 模式 */
    sideBySide?: boolean;
    /** 上下文行数（类似 git diff -U），默认 3 */
    contextLines?: number;
}
/**
 * 将 unified diff 文本渲染为 ANSI 着色行数组。
 *
 * @param diffText   unified diff 格式文本
 * @param options    渲染选项
 * @returns          ANSI 着色后的行数组（每行可直接 writeln）
 */
export declare function renderDiff(diffText: string, options?: DiffOptions): string[];
/**
 * 将 diff 渲染为单段文本（含换行符）。
 * 适用于直接 writeln 一段。
 */
export declare function renderDiffText(diffText: string, options?: DiffOptions): string;
export {};
//# sourceMappingURL=diff-viewer.d.ts.map