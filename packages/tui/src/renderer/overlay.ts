/**
 * tui/renderer/overlay.ts — 模态 Overlay（已退役骨架）
 *
 * 纯流式模式——Overlay 已退役。保留类骨架避免导入错误。
 *
 * @module tui/renderer/overlay
 * @since v4 — 退役，保留骨架
 */

import type { TuiComponent } from "./diff-renderer.js";

export interface OverlayConfig {
  title: string;
  content: string[];
  anchor: "center" | "top" | "bottom";
  width: number;
}

export class OverlayManager implements TuiComponent {
  private _active: OverlayConfig | null = null;
  private _onDismiss: (() => void) | null = null;

  render(_width: number): string[] { return []; }
  invalidate(): void {}

  show(_config: OverlayConfig, onDismiss: () => void): void {
    this._onDismiss = onDismiss;
  }

  dismiss(): void {
    this._active = null;
    this._onDismiss?.();
    this._onDismiss = null;
  }

  get active(): boolean { return this._active !== null; }
  setWidth(_w: number): void {}
}

export const overlay = new OverlayManager();
