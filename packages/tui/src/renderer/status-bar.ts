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

  /** 开始加载动画 */
  start(message: string): void {
    this._message = message;
    this._startTime = Date.now();
    this._spinning = true;
  }

  /** 停止加载 */
  stop(): void {
    this._spinning = false;
  }

  /** 更新 token 计数 */
  setTokens(used: number, max: number): void {
    this._tokenCount = used;
    this._maxTokens = max;
  }
}

export const statusBar = new StatusBar();
