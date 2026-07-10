/**
 * tui/renderer/diff-renderer.ts — 差分渲染引擎
 *
 * 只输出变化行，减少终端刷新量。
 * 参考 Pi TUI 的 doRender() 和 Component 接口。
 *
 * @module tui/renderer/diff-renderer
 * @since v3 — Core-3 差分渲染
 */

/** TUI 组件接口——所有可渲染元素实现此接口 */
export interface TuiComponent {
  render(width: number): string[];
  invalidate(): void;
}

/** 差分渲染引擎——只输出变化行 */
export class DiffRenderer {
  private _prev: string[] = [];
  private _components: Map<string, TuiComponent> = new Map();
  private _width = 80;
  private _renderQueued = false;

  register(name: string, component: TuiComponent): void {
    this._components.set(name, component);
  }

  /** 请求渲染——合并同一事件循环内的多次调用 */
  requestRender(): void {
    if (this._renderQueued) return;
    this._renderQueued = true;
    process.nextTick(() => {
      this._renderQueued = false;
      this.flush();
    });
  }

  /** 立即执行差分渲染 */
  flush(): void {
    const rows: string[] = [];
    for (const comp of this._components.values()) {
      rows.push(...comp.render(this._width));
    }

    if (this._prev.length > 0 && rows.length > 0) {
      // 差分：只重写变化行
      for (let i = 0; i < Math.min(this._prev.length, rows.length); i++) {
        if (this._prev[i] !== rows[i]) {
          process.stdout.write(`\x1b[${i + 1};1H\x1b[2K${rows[i]}`);
        }
      }
      // 清除旧的多余行
      if (rows.length < this._prev.length) {
        for (let i = rows.length; i < this._prev.length; i++) {
          process.stdout.write(`\x1b[${i + 1};1H\x1b[2K`);
        }
      }
    } else {
      process.stdout.write(rows.join("\n") + "\n");
    }
    this._prev = rows;
  }

  clear(): void {
    this._prev = [];
  }
}

export const diffRenderer = new DiffRenderer();
