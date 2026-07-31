// ============================================================
// @cortex/notification — 路由表
//
// eventType → channel + ackRequired 的 O(1) 查表路由。
// 显式路由优先，未匹配的事件默认 fallback 到 info 通道。
//
// 命名统一：routeTable key 为 snake_case（如 "code_changed"），
// 而生产事件为 PipelineEventType 值（如 "governance.amendment_proposed"）。
// resolve() 对 dotted 事件名取点号最后一段查表，保持两条命名共存。
// ============================================================

import { NotificationChannel, type RouteEntry, type RouteTableMap } from "./types.js";

/** 默认路由——未在表中显式声明的事件走 info 通道，不持久化，不确认 */
const DEFAULT_ROUTE: RouteEntry = {
  channel: NotificationChannel.Info,
  ackRequired: false,
};

/**
 * RouteTable —— 显式路由表。
 *
 * 为什么不用 if-else：
 *   新增事件类型只需在 cortex-agents.json 的 routeTable 中加一行，
 *   不需要改动任何业务代码。查表 O(1) 也不随事件种类增长而退化。
 */
export class RouteTable {
  private routes: Map<string, RouteEntry> = new Map();

  /**
   * 批量加载路由规则。
   * @param entries eventType → RouteEntry 映射
   */
  load(entries: RouteTableMap): void {
    for (const [eventType, entry] of Object.entries(entries)) {
      this.routes.set(eventType, entry);
    }
  }

  /**
   * 注册单条路由规则。
   */
  register(eventType: string, entry: RouteEntry): void {
    this.routes.set(eventType, entry);
  }

  /**
   * 查询事件类型对应的路由。
   * 未显式注册的事件走默认 info 通道。
   *
   * dotted 事件名（如 "governance.amendment_proposed"）取点号最后一段
   * （"amendment_proposed"）查表——routeTable key 与 PipelineEventType 命名共存。
   */
  resolve(eventType: string): RouteEntry {
    return this._lookup(eventType).entry;
  }

  /**
   * 是否显式命中路由（含 dotted 短名映射）。
   * 与 resolve() 配合使用：仅显式命中时才用路由覆盖调用方语义。
   */
  has(eventType: string): boolean {
    return this._lookup(eventType).explicit;
  }

  /** 内部查表——返回命中条目与是否显式命中 */
  private _lookup(eventType: string): { entry: RouteEntry; explicit: boolean } {
    const direct = this.routes.get(eventType);
    if (direct) return { entry: direct, explicit: true };

    // dotted 事件名（如 "governance.amendment_proposed"）取点号最后一段查表
    const lastDot = eventType.lastIndexOf(".");
    if (lastDot !== -1 && lastDot < eventType.length - 1) {
      const short = this.routes.get(eventType.slice(lastDot + 1));
      if (short) return { entry: short, explicit: true };
    }

    return { entry: DEFAULT_ROUTE, explicit: false };
  }

  /**
   * 获取所有已注册的事件类型。
   */
  eventTypes(): string[] {
    return Array.from(this.routes.keys());
  }

  /**
   * 获取完整路由表快照。
   */
  snapshot(): RouteTableMap {
    const result: RouteTableMap = {};
    for (const [key, value] of this.routes) {
      result[key] = { ...value };
    }
    return result;
  }

  /** 路由表大小 */
  get size(): number {
    return this.routes.size;
  }
}
