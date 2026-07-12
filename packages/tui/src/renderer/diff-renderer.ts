/**
 * tui/renderer/diff-renderer.ts — 差分渲染引擎
 *
 * v2: 去掉绝对定位 \x1b[N;1H——不再与 readline 抢屏幕。
 * 改为相对移动: 上移N行 → 清旧内容 → 写新内容。
 *
 * @module tui/renderer/diff-renderer
 * @since v3
 */

/** TUI 组件接口——所有可渲染元素实现此接口 */
export interface TuiComponent {
  render(width: number): string[];
  invalidate(): void;
}

/** 差分渲染引擎——纯流式模式，已退役 */
export class DiffRenderer {
  register(_name: string, _component: TuiComponent): void {
    /* 纯流式模式——DiffRenderer 已退役 */
  }

  requestRender(): void {
    /* 纯流式模式——DiffRenderer 已退役 */
  }

  flush(): void {
    /* 纯流式模式——DiffRenderer 已退役 */
  }

  clear(): void {
    /* 纯流式模式——DiffRenderer 已退役 */
  }
}

export const diffRenderer = new DiffRenderer();
