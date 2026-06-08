// ============================================================
// @cortex/notification — 路由表
//
// eventType → channel + ackRequired 的 O(1) 查表路由。
// 显式路由优先，未匹配的事件默认 fallback 到 info 通道。
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
   */
  resolve(eventType: string): RouteEntry {
    return this.routes.get(eventType) ?? DEFAULT_ROUTE;
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
