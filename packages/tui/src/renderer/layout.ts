import type { TuiComponent } from "./diff-renderer.js";

/** 面板锚定点 */
type Anchor = "top" | "fill" | "bottom";

interface Panel {
  component: TuiComponent;
  anchor: Anchor;
  /** 固定行数（top/bottom），fill 忽略 */
  height?: number;
}

/**
 * 三层布局引擎。
 *
 * Layer1(fill): ChatLog + task-tree + toolCard — 主要内容，占满剩余空间
 * Layer2(overlay): 模态弹窗 — 半屏覆盖 Layer1
 * Layer3(bottom): StatusBar + Footer — 固定底部
 */
export class Layout implements TuiComponent {
  private _panels: Panel[] = [];
  private _width = 80;
  private _terminalRows = 24;

  setTerminalSize(cols: number, rows: number): void {
    this._width = cols;
    this._terminalRows = rows;
  }

  /** 添加面板 */
  add(component: TuiComponent, anchor: Anchor, height?: number): void {
    this._panels.push({ component, anchor, height });
  }

  /** 移除面板 */
  remove(component: TuiComponent): void {
    this._panels = this._panels.filter(p => p.component !== component);
  }

  render(_width: number): string[] {
    const rows: string[] = [];

    // 计算固定区域占用
    const bottomPanels = this._panels.filter(p => p.anchor === "bottom");
    const bottomLines = bottomPanels.reduce((sum, p) => sum + (p.height ?? 1), 0);

    const topPanels = this._panels.filter(p => p.anchor === "top");
    const topLines = topPanels.reduce((sum, p) => sum + (p.height ?? 1), 0);

    // 填充区域可用行数
    const fillAvailable = Math.max(1, this._terminalRows - bottomLines - topLines);

    // 渲染顶部
    for (const p of topPanels) {
      const r = p.component.render(this._width);
      rows.push(...r.slice(0, p.height ?? r.length));
    }

    // 渲染填充区域（Layer1 主战场）
    for (const p of this._panels.filter(p => p.anchor === "fill")) {
      const r = p.component.render(this._width);
      const take = Math.min(fillAvailable, r.length);
      rows.push(...r.slice(0, take));
    }

    // 不补充空行：启动时无内容不应占满屏幕
    // 只有内容区有数据时才按需渲染

    // 渲染底部
    for (const p of bottomPanels) {
      const r = p.component.render(this._width);
      rows.push(...r.slice(0, p.height ?? r.length));
    }

    return rows;
  }

  invalidate(): void {}
}

export const layout = new Layout();
