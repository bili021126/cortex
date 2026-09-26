/**
 * @cortex/config — 事件路由配置接口
 *
 * @module interfaces/event-routing
 * @layer root — 零依赖，纯类型层
 */

/** 路由表条目 */
export interface RouteTableEntry {
  channel: string;
  ackRequired: boolean;
}

/** 路由表——eventType → channel + ackRequired */
export type RouteTableMap = Record<string, RouteTableEntry>;

/** 委员会召集规则 */
export interface CommitteeRule {
  id: string;
  triggerEvent: string;
  members: string[];
  urgent: boolean;
}

/**
 * 归并规则——与 `@cortex/notification` 的 `MergeRule` 结构一致。
 * config 层零依赖，故此处是结构镜像而非 import；engine 侧收窄回 notification 类型。
 */
export interface MergeRuleConfig {
  /** 归并键字段名（notification 的 NotificationPipe 只认 "mergeKey"） */
  groupBy: string;
  /** 时间窗口（ms）——同键事件在此窗口内归并为一条 */
  windowMs: number;
  /** 最大归并数——同键累计到此数量立即 flush，不必等窗口到期 */
  maxBatch: number;
}

/** 事件路由配置 */
export interface EventRoutingConfig {
  routeTable: RouteTableMap;
  channels?: Record<string, unknown>;
  /** 归并规则——缺省时通知管线不做任何归并（高频事件将逐条落盘） */
  mergeRules?: MergeRuleConfig[];
  committeeRules?: CommitteeRule[];
}
