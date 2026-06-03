// ============================================================
// 🌿 Cortex 技能注册表 — 生命周期钩子管理器
// 设计：纳西妲 | 实现：阿贝多
//
// 基于发布-订阅模式的事件管理器
//
// @moved-from projects/solo-flight/src/skill/lifecycle.ts
// ============================================================

import type {
  RegistryEvent,
  RegistryEventHandler,
} from './types.js';

export class LifecycleManager {
  /** 事件 → 处理器列表 */
  private readonly handlers = new Map<RegistryEvent, Set<RegistryEventHandler>>();

  /** 是否已启动 */
  private _started = false;

  /** 是否已关闭 */
  private _shutdown = false;

  get started(): boolean {
    return this._started;
  }

  get shutdown(): boolean {
    return this._shutdown;
  }

  /** 注册事件处理器 */
  on(event: RegistryEvent, handler: RegistryEventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /** 移除事件处理器 */
  off(event: RegistryEvent, handler: RegistryEventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  /** 触发事件 */
  async emit(event: RegistryEvent, payload?: unknown): Promise<void> {
    const handlers = this.handlers.get(event);
    if (!handlers || handlers.size === 0) return;

    const errors: unknown[] = [];
    for (const handler of handlers) {
      try {
        await handler(payload);
      } catch (err) {
        errors.push(err);
      }
    }

    if (errors.length > 0) {
      const messages = errors.map((e) => String(e)).join('; ');
      throw new Error(`事件「${event}」的 ${errors.length} 个处理器执行出错: ${messages}`);
    }
  }

  /** 清空所有处理器 */
  clear(): void {
    this.handlers.clear();
    this._started = false;
    this._shutdown = false;
  }
}
