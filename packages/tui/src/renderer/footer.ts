/**
 * tui/renderer/footer.ts — Footer 多段信息条
 *
 * 终端底部信息条，支持多段 segments 展示。
 * 参考 Pi TUI 的 Footer 实现。
 *
 * @module tui/renderer/footer
 * @since v3 — P2 Footer 多段信息条
 */

import type { TuiComponent } from "./diff-renderer.js";

interface FooterSegment {
  label: string;
  value: string;
}

export class Footer implements TuiComponent {
  private _segments: FooterSegment[] = [];
  private _width = 80;

  setWidth(w: number): void { this._width = w; }

  setSegments(segs: FooterSegment[]): void {
    this._segments = segs;
  }

  render(_width: number): string[] {
    if (this._segments.length === 0) return [];
    const parts = this._segments.map(s => `${s.label}: ${s.value}`);
    const line = parts.join(" │ ");
    const bar = "─".repeat(Math.min(line.length + 4, this._width));
    return [`\x1b[7m ${line} \x1b[0m`, bar];
  }

  invalidate(): void {}
}

export const footer = new Footer();
