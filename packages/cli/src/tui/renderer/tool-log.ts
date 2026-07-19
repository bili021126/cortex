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

// ═══════════════════════════════════════════════════════════
// §1 ToolLogRenderer
// ═══════════════════════════════════════════════════════════

/** 进行中的工具调用（用于计算耗时） */
interface PendingCall {
  tool: string;
  input: string;
  startTime: number;
}

export class ToolLogRenderer {
  private pending: Map<string, PendingCall> = new Map();
  private callSeq: number = 0;

  /** 处理事件 */
  handleEvent(event: TuiEvent): void {
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
  private onToolStart(tool: string, input: string, nodeId?: string): void {
    const id = nodeId ?? `call_${++this.callSeq}`;
    this.pending.set(id, { tool, input, startTime: Date.now() });
    /* 纯流式模式——ToolLog 不再触发渲染 */
  }

  /** 工具完成 */
  private onToolResult(
    tool: string,
    success: boolean,
    output?: string,
    error?: string,
    durationMs?: number,
    nodeId?: string,
  ): void {
    // 尝试匹配 pending call
    let duration = durationMs;
    if (nodeId) {
      const pc = this.pending.get(nodeId);
      if (!pc) return;
      // eslint-disable-next-line no-useless-assignment
      duration = duration ?? (Date.now() - pc.startTime);
      this.pending.delete(nodeId);
    }

    /* 纯流式模式——ToolLog 不再触发渲染 */
  }
}
