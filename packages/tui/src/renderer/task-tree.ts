/**
 * tui/renderer/task-tree.ts — 任务树渲染器（已退役骨架）
 *
 * 纯流式模式——任务树直接走 stdout 追加。保留类骨架避免导入错误。
 *
 * @module tui/renderer/task-tree
 * @since v4 — 退役，保留骨架
 */

import type { TuiEvent } from "../types.js";
import type { TuiComponent } from "./diff-renderer.js";

export class TaskTreeRenderer implements TuiComponent {
  handleEvent(_event: TuiEvent): void {}
  render(_width: number): string[] { return []; }
  invalidate(): void {}
  clear(): void {}
}
