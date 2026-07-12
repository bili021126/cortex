/**
 * tui/renderer/status-bar.ts — 状态 Loader + 缓冲渲染
 *
 * spinner + 消息 + 计时 + token 计数。
 * 参考 OpenClaw Loader + Cyrene deltaQueue 40ms batching。
 *
 * @module tui/renderer/status-bar
 * @since v3 — Core-3 差分渲染
 */

import type { TuiComponent } from "./diff-renderer.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class StatusBar implements TuiComponent {
  private _message = "";
  private _startTime = 0;
  private _spinning = false;
  private _frame = 0;
  private _animTimer: ReturnType<typeof setInterval> | null = null;
  private _tokenCount = 0;
  private _maxTokens = 0;

  render(_width: number): string[] {
    const elapsed = this._spinning ? Math.floor((Date.now() - this._startTime) / 1000) : 0;
    const spinner = this._spinning ? SPINNER_FRAMES[this._frame % SPINNER_FRAMES.length] : " ";
    const tokens = this._maxTokens > 0
      ? ` ${this._tokenCount}/${this._maxTokens}`
      : "";
    return [`${spinner} ${this._message}${elapsed > 0 ? ` · ${elapsed}s` : ""}${tokens}`];
  }

  invalidate(): void { this._frame++; }

  /** 开始加载动画——纯流式模式：不再触发渲染 */
  start(message: string): void {
    this._message = message;
    this._startTime = Date.now();
    this._spinning = false;
    /* 纯流式模式——StatusBar 不再触发渲染 */
  }

  /** 停止加载（清空消息行） */
  stop(): void {
    this._spinning = false;
    this._message = "";
    this._startTime = 0;
    if (this._animTimer) { clearInterval(this._animTimer); this._animTimer = null; }
    /* 纯流式模式——StatusBar 不再触发渲染 */
  }

  /** 更新 token 计数 */
  setTokens(used: number, max: number): void {
    this._tokenCount = used;
    this._maxTokens = max;
  }
}

export const statusBar = new StatusBar();
