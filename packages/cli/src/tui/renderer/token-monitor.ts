/**
 * tui/renderer/token-monitor.ts — Token 用量实时面板
 *
 * Claude Code 标志性功能——实时显示 Token 消耗和上下文窗口压力。
 * 每次 LLM API 调用后更新，累加会话总 token。
 *
 * 渲染格式（终端底部固定行）：
 * ```
 * 📊 Token: 输入 12.4k | 输出 3.2k | 上下文 58% | 本次会话 45k
 * ```
 *
 * @module tui/renderer/token-monitor
 * @since v3 — CLI TUI 全栈重构
 */

import type { TuiEvent } from "../types.js";
import { StatusLine, style, terminalWidth, StyleCode, ColorCode } from "./ansi.js";

// ═══════════════════════════════════════════════════════════
// §1 格式化工具
// ═══════════════════════════════════════════════════════════

/** 格式化 token 数（>=1000 用 k） */
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** 进度条（Unicode block） */
function progressBar(ratio: number, width: number = 12): string {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  let color: number;
  if (ratio < 0.5) color = ColorCode.green;
  else if (ratio < 0.8) color = ColorCode.yellow;
  else color = ColorCode.red;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return style(bar, color);
}

// ═══════════════════════════════════════════════════════════
// §2 TokenMonitor
// ═══════════════════════════════════════════════════════════

export class TokenMonitor {
  private sessionPromptTokens = 0;
  private sessionCompletionTokens = 0;
  private contextWindowSize = 128000; // 默认 DeepSeek 128k
  private statusLine: StatusLine;
  private visible: boolean = true;

  constructor(statusLine?: StatusLine) {
    this.statusLine = statusLine ?? new StatusLine(1);
  }

  /** 处理事件 */
  handleEvent(event: TuiEvent): void {
    if (event.type !== "token_usage") return;
    this.update(event);
  }

  /** 更新 Token 数据 */
  private update(event: { promptTokens: number; completionTokens: number; contextWindowSize: number }): void {
    this.sessionPromptTokens += event.promptTokens;
    this.sessionCompletionTokens += event.completionTokens;
    if (event.contextWindowSize > 0) {
      this.contextWindowSize = event.contextWindowSize;
    }
    this.renderStatusLine();
  }

  /** 渲染底部状态行 */
  private renderStatusLine(): void {
    if (!this.visible) return;
    const w = Math.min(terminalWidth(), 120);
    const contextRatio = this.sessionPromptTokens / this.contextWindowSize;
    const contextPct = Math.round(contextRatio * 100);
    const bar = progressBar(contextRatio);
    const total = this.sessionPromptTokens + this.sessionCompletionTokens;
    const text = [
      "📊 Token:",
      `输入 ${style(formatTokens(this.sessionPromptTokens), ColorCode.cyan)}`,
      `| 输出 ${style(formatTokens(this.sessionCompletionTokens), ColorCode.cyan)}`,
      `| 上下文 ${style(`${contextPct}%`, contextRatio > 0.8 ? ColorCode.red : StyleCode.dim)} ${bar}`,
      `| 本次会话 ${style(formatTokens(total), StyleCode.bold)}`,
    ].join(" ");
    this.statusLine.update(text.slice(0, w));
  }

  /** 获取会话总 Token */
  get sessionTotalTokens(): number {
    return this.sessionPromptTokens + this.sessionCompletionTokens;
  }

  /** 获取上下文占用比例 */
  get contextUsageRatio(): number {
    return this.sessionPromptTokens / this.contextWindowSize;
  }

  /** 设置上下文窗口大小 */
  setContextWindowSize(size: number): void {
    this.contextWindowSize = size;
    this.renderStatusLine();
  }

  /** 设置可见性 */
  setVisible(v: boolean): void {
    this.visible = v;
    if (v) {
      this.statusLine.show();
      this.renderStatusLine();
    } else {
      this.statusLine.hide();
    }
  }

  /** 重置会话计数 */
  reset(): void {
    this.sessionPromptTokens = 0;
    this.sessionCompletionTokens = 0;
  }

  /** 清理资源 */
  dispose(): void {
    this.statusLine.clear();
  }
}
