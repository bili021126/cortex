/**
 * tui/renderer/tool-card.ts — Tool 调用卡片（已退役骨架）
 *
 * 纯流式模式——Tool 状态直接走 stdout 追加。保留类骨架避免导入错误。
 *
 * @module tui/renderer/tool-card
 * @since v4 — 退役，保留骨架
 */

import type { TuiComponent } from "./diff-renderer.js";

export class ToolCard implements TuiComponent {
  render(_width: number): string[] { return []; }
  invalidate(): void {}
  add(_id: string, _tool: string): void {}
  complete(_id: string, _output: string, _durationMs: number, _success: boolean): void {}
  toggle(_id: string): void {}
  clear(): void {}
  reset(): void {}
}

export const toolCard = new ToolCard();
