/**
 * tui/renderer/tool-log.ts — 工具调用日志渲染器
 *
 * 实时渲染工具调用日志——显示工具名、输入参数、执行时长和结果状态。
 * 支持 tool_start 和 tool_result 事件，用颜色标记成功/失败。
 *
 * 渲染格式：
 * ```
 * 🔧 read_file (12ms) ✓   d:\cortex\package.json
 * 🔧 grep (8ms)       ✗   no matches found
 * ```
 *
 * @module tui/renderer/tool-log
 * @since v3 — CLI TUI 全栈重构
 */
import type { TuiEvent } from "../types.js";
export declare class ToolLogRenderer {
    private pending;
    private callSeq;
    /** 处理事件 */
    handleEvent(event: TuiEvent): void;
    /** 工具开始 */
    private onToolStart;
    /** 工具完成 */
    private onToolResult;
}
//# sourceMappingURL=tool-log.d.ts.map