/**
 * tui/renderer/ansi.ts — ANSI 渲染原语
 *
 * 零依赖的终端控制能力层。所有 ANSI escape 序列集中在此文件，
 * 其余模块通过语义化 API 调用，不直接拼接 escape 字符串。
 *
 * 设计原则：
 * - 所有 escape 写在一个文件里，调色盘统一管理
 * - 语义化 API：调用 cursorUp(2) 而非手写 \x1b[2A
 * - Box 增量更新：只重绘变化行，不刷新整个面板
 * - StatusLine：终端底部固定行，内容更新不滚动
 *
 * @module tui/renderer/ansi
 * @since v3 — CLI TUI 全栈重构
 */
/** ANSI 样式码 */
export declare const StyleCode: {
    readonly reset: 0;
    readonly bold: 1;
    readonly dim: 2;
    readonly italic: 3;
    readonly underline: 4;
    readonly strikethrough: 9;
};
/** 标准 16 色 ANSI 色码 */
export declare const ColorCode: {
    readonly black: 30;
    readonly red: 31;
    readonly green: 32;
    readonly yellow: 33;
    readonly blue: 34;
    readonly magenta: 35;
    readonly cyan: 36;
    readonly white: 37;
    readonly brightBlack: 90;
    readonly brightRed: 91;
    readonly brightGreen: 92;
    readonly brightYellow: 93;
    readonly brightBlue: 94;
    readonly brightMagenta: 95;
    readonly brightCyan: 96;
    readonly brightWhite: 97;
};
export type ColorName = keyof typeof ColorCode;
export type StyleName = keyof typeof StyleCode;
/** 光标上移 n 行 */
export declare function cursorUp(n?: number): string;
/** 光标下移 n 行 */
export declare function cursorDown(n?: number): string;
/** 光标右移 n 列 */
export declare function cursorRight(n?: number): string;
/** 光标移动到指定列 */
export declare function cursorToColumn(col: number): string;
/** 隐藏光标 */
export declare const cursorHide = "\u001B[?25l";
/** 显示光标 */
export declare const cursorShow = "\u001B[?25h";
/** 保存光标位置 */
export declare const cursorSave = "\u001B7";
/** 恢复光标位置 */
export declare const cursorRestore = "\u001B8";
/** 擦除当前行 */
export declare const eraseLine = "\u001B[2K";
/** 擦除从光标到行首 */
export declare const eraseLineStart = "\u001B[1K";
/** 擦除从光标到行尾 */
export declare const eraseLineEnd = "\u001B[0K";
/** 擦除整个屏幕 */
export declare const eraseScreen = "\u001B[2J";
/** 擦除从光标到屏幕尾 */
export declare const eraseScreenDown = "\u001B[0J";
/** 向上滚动 n 行 */
export declare function scrollUp(n?: number): string;
/** 向下滚动 n 行 */
export declare function scrollDown(n?: number): string;
/**
 * 为文本包裹 ANSI 样式。
 *
 * @param text 原始文本
 * @param codes ANSI 样式码（可多个组合）
 * @returns 包裹后的文本
 */
export declare function style(text: string, ...codes: number[]): string;
/** ANSI 256 色前景色 */
export declare function fg256(code: number): string;
/** ANSI 256 色背景色 */
export declare function bg256(code: number): string;
/** 重置全部样式 */
export declare const styleReset = "\u001B[0m";
export declare function bold(text: string): string;
export declare function dim(text: string): string;
export declare function italic(text: string): string;
export declare function underline(text: string): string;
/** 指定标准色 */
export declare function color(text: string, c: ColorName): string;
/** ANSI 256 色 */
export declare function color256(text: string, code: number): string;
/**
 * Box — 虚拟矩形渲染区域。
 *
 * 维护一个二维字符缓冲区，支持增量更新：
 * - write(x, y, text)：在指定位置写入文本
 * - render()：输出 ANSI 序列，仅更新变化区域
 * - 支持嵌套 Box（相对坐标）
 */
export declare class Box {
    private width;
    private height;
    private buffer;
    private prev;
    private topRow;
    constructor(width: number, height: number, topRow?: number);
    /** 在指定位置写入文本（超出截断） */
    write(x: number, y: number, text: string): void;
    /** 用预格式化行填充 */
    writeRow(y: number, text: string): void;
    /** 清空缓冲区 */
    clear(): void;
    /** 获取当前行内容（不含 ANSI escape 的纯文本视图） */
    getRow(y: number): string;
    /**
     * 增量渲染——只输出与上次渲染不同的行。
     * 首次渲染输出所有行。
     *
     * @returns ANSI 控制序列字符串
     */
    render(): string;
    /** 完整重绘（强制输出所有行） */
    renderFull(): string;
    get dimensions(): {
        width: number;
        height: number;
        topRow: number;
    };
}
/**
 * StatusLine — 终端底部固定行。
 *
 * 显示 Token 用量、耗时、当前 Agent 等信息。
 * 内容更新时只重写此行，不影响上方内容的滚动。
 */
export declare class StatusLine {
    private content;
    private visible;
    private height;
    constructor(height?: number);
    /** 更新状态行内容 */
    update(text: string): void;
    /** 渲染状态行到终端 */
    private render;
    /** 显示状态行 */
    show(): void;
    /** 隐藏状态行 */
    hide(): void;
    /** 清空并隐藏 */
    clear(): void;
    get isVisible(): boolean;
}
/** 获取终端宽度（列数），默认 80 */
export declare function terminalWidth(): number;
/** 获取终端高度（行数），默认 24 */
export declare function terminalHeight(): number;
/** 写入终端（直接输出字符串，不换行） */
export declare function write(text: string): void;
/** 写入终端并换行 */
export declare function writeln(text: string): void;
//# sourceMappingURL=ansi.d.ts.map