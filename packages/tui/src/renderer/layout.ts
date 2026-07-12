/**
 * tui/renderer/layout.ts — 三层布局引擎（已退役骨架）
 *
 * 纯流式模式——Layout 已退役。保留类骨架避免导入错误。
 *
 * @module tui/renderer/layout
 * @since v4 — 退役，保留骨架
 */

import type { TuiComponent } from "./diff-renderer.js";

/** 三层布局引擎——纯流式模式，已退役 */
export class Layout implements TuiComponent {
  setTerminalSize(_cols: number, _rows: number): void {}
  add(_component: TuiComponent, _anchor: string, _height?: number): void {}
  remove(_component: TuiComponent): void {}
  render(_width: number): string[] { return []; }
  invalidate(): void {}
}

export const layout = new Layout();
