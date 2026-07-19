/**
 * tui/interaction/focus-manager.ts — 焦点管理器
 *
 * 管理 TUI 中各区域的焦点状态，支持浮层栈。
 *
 * @module tui/interaction/focus-manager
 * @since v6
 */

import type { FocusZone } from "./types.js";

export type FocusChangeCallback = (from: FocusZone, to: FocusZone) => void;

/**
 * 焦点管理器
 */
export class FocusManager {
  private zones: FocusZone[] = ["input", "chat", "sidebar", "statusbar"];
  private current: FocusZone = "input";
  private overlayStack: FocusZone[] = [];
  private listeners: FocusChangeCallback[] = [];

  /**
   * 聚焦到指定区域
   */
  focus(zone: FocusZone): void {
    if (zone === this.current) return;
    const from = this.current;
    this.current = zone;
    this.notifyListeners(from, zone);
  }

  /**
   * 推入浮层（如命令面板、权限对话框）
   */
  pushOverlay(zone: FocusZone): void {
    this.overlayStack.push(this.current);
    this.focus(zone);
  }

  /**
   * 弹出浮层（恢复到之前的焦点区域）
   */
  popOverlay(): void {
    const prev = this.overlayStack.pop();
    if (prev) {
      this.focus(prev);
    }
  }

  /**
   * 获取当前焦点区域
   */
  getCurrent(): FocusZone {
    return this.current;
  }

  /**
   * 是否有浮层打开
   */
  hasOverlay(): boolean {
    return this.overlayStack.length > 0;
  }

  /**
   * 注册焦点变化监听
   */
  onFocusChange(callback: FocusChangeCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  /**
   * 通知监听器
   */
  private notifyListeners(from: FocusZone, to: FocusZone): void {
    for (const listener of this.listeners) {
      try {
        listener(from, to);
      } catch {
        // 静默处理监听器异常
      }
    }
  }

  /**
   * 获取可用区域列表
   */
  getZones(): FocusZone[] {
    return [...this.zones];
  }

  /**
   * 注册新的焦点区域
   */
  addZone(zone: FocusZone): void {
    if (!this.zones.includes(zone)) {
      this.zones.push(zone);
    }
  }
}
