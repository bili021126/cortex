import { PipelineEventType, type ObservableEvent, type PipelineHandler } from "@cortex/shared";
/**
 * 信号层级——事件的严重程度分类。
 */
export type SignalLevel = "L1" | "L2" | "L3";
/**
 * 过滤后的信号——附带层级标注和处理建议。
 */
export interface FilteredSignal {
    /** 原始事件 */
    event: ObservableEvent;
    /** 信号层级 */
    level: SignalLevel;
    /** 是否需要立即处理 */
    requiresImmediateAction: boolean;
    /** 聚合键——用于去噪（同类事件合并） */
    aggregationKey: string;
    /** 建议的处理动作 */
    suggestedAction: "alert" | "log" | "sample" | "ignore";
    /** 信号来源——规则验证通过后为 "rule"，否则为 "llm-inference" */
    source: "rule" | "llm-inference";
}
/**
 * 哨兵信号过滤器配置。
 */
export interface SignalFilterOptions {
    /** L1 事件类型列表——匹配这些类型的事件视为 L1 */
    l1EventTypes?: PipelineEventType[];
    /** L2 事件类型列表——匹配这些类型的事件视为 L2 */
    l2EventTypes?: PipelineEventType[];
    /** 去噪时间窗口 (ms)——同类事件在此窗口内聚合，默认 5000 */
    deduplicationWindowMs?: number;
    /** L3 采样率 (0-1)——L3 事件按比例记录，默认 0.1 (10%) */
    l3SampleRate?: number;
    /** 告警风暴阈值——同 aggregationKey 在窗口内超过此数量触发风暴告警，默认 10 */
    alertStormThreshold?: number;
}
/**
 * 哨兵信号分层过滤器——将事件流按 L1/L2/L3 分层，供哨兵订阅。
 *
 * 典型用法：
 *   ```typescript
 *   const filter = new SentinelSignalFilter({
 *     l1EventTypes: [PipelineEventType.SchedulerCrashed, PipelineEventType.SecurityViolation],
 *     l2EventTypes: [PipelineEventType.ErrorReported, PipelineEventType.PoolQuotaExhausted],
 *   });
 *
 *   observer.on(PipelinePriority.CRITICAL, (event) => {
 *     const signal = filter.filter(event);
 *     if (signal.level === "L1") {
 *       alertPagerDuty(signal);
 *     }
 *   });
 *   ```
 */
export declare class SentinelSignalFilter {
    private readonly config;
    private readonly validator;
    /** 去噪缓存：aggregationKey → { count, firstSeenAt, lastSeenAt } */
    private readonly dedupCache;
    constructor(options?: SignalFilterOptions);
    /**
     * 过滤事件——产出分层信号。
     *
     * 逻辑：
     *   1. 匹配 l1EventTypes → L1 (requiresImmediateAction=true)
     *   2. 匹配 l2EventTypes → L2 (requiresImmediateAction=false)
     *   3. 其他 → L3 (采样/聚合)
     *
     * 去噪：同类事件在时间窗口内聚合，返回聚合后的信号。
     * 采样：L3 事件按 l3SampleRate 比例返回，其余返回 null。
     */
    filter(event: ObservableEvent): FilteredSignal | null;
    /**
     * 创建 PipelineHandler——可直接注册到 observer。
     * 过滤后的信号通过回调传出。
     */
    createHandler(onSignal: (signal: FilteredSignal) => void): PipelineHandler;
    /**
     * 获取去噪统计——用于可观测性。
     */
    getStats(): {
        cacheSize: number;
        topKeys: Array<{
            key: string;
            count: number;
        }>;
    };
    /**
     * 清理过期缓存条目。
     */
    private _cleanupExpiredEntries;
    /**
     * 生成聚合键——用于去噪。
     * 同类事件（相同 type + 关键 payload 字段）共享聚合键。
     */
    private _generateAggregationKey;
    /** 治理事件走零 token 规则验证，其余事件默认 rule */
    private _resolveSource;
}
//# sourceMappingURL=sentinel-signal-filter.d.ts.map