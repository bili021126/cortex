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
import { writeln, style, StyleCode, ColorCode } from "./ansi.js";
// ═══════════════════════════════════════════════════════════
// §1 辅助
// ═══════════════════════════════════════════════════════════
/** 截断长文本 */
function truncate(text, maxLen = 60) {
    return text.length > maxLen ? text.slice(0, maxLen - 3) + "..." : text;
}
/** 工具图标映射 */
const TOOL_ICONS = {
    read_file: "📖",
    write: "✏️",
    search_replace: "🔄",
    delete_file: "🗑",
    bash: "💻",
    glob: "🔍",
    grep: "🔎",
    web_fetch: "🌐",
    web_search: "🔎",
};
function toolIcon(tool) {
    return TOOL_ICONS[tool] ?? "🔧";
}
export class ToolLogRenderer {
    pending = new Map();
    callSeq = 0;
    /** 处理事件 */
    handleEvent(event) {
        switch (event.type) {
            case "tool_start":
                this.onToolStart(event.tool, event.input, event.nodeId);
                break;
            case "tool_result":
                this.onToolResult(event.tool, event.success, event.output, event.error, event.durationMs, event.nodeId);
                break;
        }
    }
    /** 工具开始 */
    onToolStart(tool, input, nodeId) {
        const id = nodeId ?? `call_${++this.callSeq}`;
        this.pending.set(id, { tool, input, startTime: Date.now() });
        writeln(`${toolIcon(tool)} ${style(tool, StyleCode.bold)} ${style("...", StyleCode.dim)}  ${style(truncate(input), StyleCode.dim)}`);
    }
    /** 工具完成 */
    onToolResult(tool, success, output, error, durationMs, nodeId) {
        // 尝试匹配 pending call
        let duration = durationMs;
        if (nodeId) {
            const pc = this.pending.get(nodeId);
            if (!pc)
                return;
            duration = duration ?? (Date.now() - pc.startTime);
            this.pending.delete(nodeId);
        }
        const timeStr = duration !== undefined ? `(${duration}ms)` : "";
        const statusIcon = success
            ? style("✓", ColorCode.green)
            : style("✗", ColorCode.red);
        const detail = success
            ? style(truncate(output ?? ""), StyleCode.dim)
            : style(truncate(error ?? output ?? "未知错误"), ColorCode.red);
        writeln(`  ${statusIcon} ${style(timeStr, StyleCode.dim)} ${detail}`);
    }
}
//# sourceMappingURL=tool-log.js.map