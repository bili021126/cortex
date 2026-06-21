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
/** 事件路由配置 */
export interface EventRoutingConfig {
    routeTable: RouteTableMap;
    channels?: Record<string, unknown>;
    mergeRules?: unknown[];
    committeeRules?: CommitteeRule[];
}
//# sourceMappingURL=event-routing.d.ts.map