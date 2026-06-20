/**
 * tui/event-bus.ts — TUI 事件总线
 *
 * 执行事件流的发布-订阅中枢。queryLoop 作为事件生产者，
 * 各渲染组件（task-tree/tool-log/token-monitor 等）作为消费者。
 *
 * 设计原则：
 * - 类型安全的事件订阅（基于 TuiEvent 联合类型）
 * - 通配符订阅（"*" 监听所有事件）
 * - 无外部依赖，纯内存事件分发
 *
 * @module tui/event-bus
 * @since v3 — CLI TUI 全栈重构
 */

import type { TuiEvent } from "./types.js";

/** 事件监听器签名 */
export type TuiEventListener = (event: TuiEvent) => void;

/** 按事件类型分组的监听器 */
type ListenerMap = Map<string, Set<TuiEventListener>>;

export class TuiEventBus {
  private listeners: ListenerMap = new Map();

  /** 订阅特定事件类型。type="*" 订阅所有事件。 */
  on(eventType: TuiEvent["type"] | "*", listener: TuiEventListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    const listeners = this.listeners.get(eventType);
    if (!listeners) return () => {};
    listeners.add(listener);

    // 返回取消订阅函数
    return () => {
      this.off(eventType, listener);
    };
  }

  /** 取消订阅 */
  off(eventType: TuiEvent["type"] | "*", listener: TuiEventListener): void {
    const set = this.listeners.get(eventType);
    if (set) {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(eventType);
    }
  }

  /** 发布事件——同步调用所有匹配的监听器 */
  emit(event: TuiEvent): void {
    // 1. 类型匹配的监听器
    const typed = this.listeners.get(event.type);
    if (typed) {
      for (const listener of typed) {
        try {
          listener(event);
        } catch (_err) {
          // 静默吞掉单个监听器的异常，避免影响其他监听器
          // 生产环境可用 process.stderr 输出
        }
      }
    }

    // 2. 通配符监听器
    const wildcard = this.listeners.get("*");
    if (wildcard) {
      for (const listener of wildcard) {
        try {
          listener(event);
        } catch {
          // 同上
        }
      }
    }
  }

  /** 一次性订阅——事件触发后自动取消订阅 */
  once(eventType: TuiEvent["type"], listener: TuiEventListener): void {
    const wrapper: TuiEventListener = (event) => {
      this.off(eventType, wrapper);
      listener(event);
    };
    this.on(eventType, wrapper);
  }

  /** 清空所有监听器 */
  clear(): void {
    this.listeners.clear();
  }

  /** 当前监听器数量（调试用） */
  get listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }
}

/** 全局单例事件总线 */
export const tuiEventBus = new TuiEventBus();
