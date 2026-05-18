// ============================================================
// @cortex/factory — 事件路由器组装器
//
// 将 EventRoutingConfig 组装为 NotificationPipe 可用的配置。
// ============================================================

import type { RouteTableMap, MergeRule } from "@cortex/notification";
import type { CortexAgentsConfig } from "../types.js";

/** 组装后的事件路由配置 */
export interface AssembledEventRouter {
  /** 路由表 */
  routeTable: RouteTableMap;
  /** 归并规则 */
  mergeRules: MergeRule[];
}

/**
 * 将 cortex-agents.json 中的 eventRouting 组装为运行时配置。
 */
export function assembleEventRouter(config: CortexAgentsConfig): AssembledEventRouter {
  const routing = config.eventRouting;

  return {
    routeTable: routing.routeTable,
    mergeRules: (routing.mergeRules ?? []) as MergeRule[],
  };
}
