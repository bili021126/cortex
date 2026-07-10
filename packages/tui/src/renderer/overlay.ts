/**
 * tui/renderer/overlay.ts — 模态 Overlay
 *
 * 在终端上叠加模态弹窗，支持居中/顶部/底部锚定。
 * 参考 Pi TUI 的 Overlay 实现。
 *
 * @module tui/renderer/overlay
 * @since v3 — P1 模态 Overlay
 */

import type { TuiComponent } from "./diff-renderer.js";

export interface OverlayConfig {
  title: string;
  content: string[];
  anchor: "center" | "top" | "bottom";
  width: number; // 相对终端宽度的百分比 10-90
}

export class OverlayManager {
  private _active: OverlayConfig | null = null;
  private _onDismiss: (() => void) | null = null;
  private _fullWidth = 80;

  setWidth(w: number): void { this._fullWidth = w; }

  show(config: OverlayConfig, onDismiss: () => void): void {
    this._active = config;
    this._onDismiss = onDismiss;
    this._render();
  }

  dismiss(): void {
    this._active = null;
    this._onDismiss?.();
    this._onDismiss = null;
  }

  get active(): boolean { return this._active !== null; }

  private _render(): void {
    if (!this._active) return;
    const { title, content, anchor, width: pct } = this._active;
    const w = Math.floor(this._fullWidth * pct / 100);
    const pad = Math.floor((this._fullWidth - w) / 2);
    const topPad = anchor === "center" ? Math.floor(process.stdout.rows / 3) : 0;

    const lines: string[] = [];
    lines.push(`${" ".repeat(pad)}┌${"─".repeat(Math.max(0, w - 2))}┐`);
    lines.push(`${" ".repeat(pad)}│ ${title.padEnd(Math.max(0, w - 4))} │`);
    lines.push(`${" ".repeat(pad)}├${"─".repeat(Math.max(0, w - 2))}┤`);
    for (const l of content.slice(0, 10)) {
      lines.push(`${" ".repeat(pad)}│ ${l.slice(0, w - 4).padEnd(Math.max(0, w - 4))} │`);
    }
    lines.push(`${" ".repeat(pad)}└${"─".repeat(Math.max(0, w - 2))}┘`);
    lines.push("");

    if (topPad > 0) process.stdout.write(`\x1b[${topPad};1H`);
    process.stdout.write(lines.join("\n"));
  }
}

export const overlay = new OverlayManager();
