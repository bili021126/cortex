import { Registry } from "@cortex/resilience";
/**
 * 韧性策略配置——引擎组件的韧性增强选项。
 */
export interface ResilienceOptions {
    /** 重试策略 */
    retry?: {
        maxAttempts: number;
        baseDelayMs: number;
        maxDelayMs: number;
    };
    /** 断路器策略 */
    circuitBreaker?: {
        threshold: number;
        halfOpenAfterMs: number;
    };
    /** 超时策略 */
    timeout?: {
        timeoutMs: number;
    };
}
/**
 * 韧性策略工厂——根据配置创建并注册策略实例。
 */
export declare class ResiliencePolicyFactory {
    private readonly registry;
    constructor();
    /**
     * 注册韧性策略——为指定组件注册 retry + circuit breaker + timeout。
     *
     * @param componentName 组件名（用于 Registry key 和遥测标签）
     * @param options 韧性配置
     */
    registerPolicies(componentName: string, options: ResilienceOptions): void;
    /**
     * 执行韧性保护函数——通过 Registry 组合 retry + circuit breaker + timeout。
     *
     * @param componentName 组件名（必须已注册）
     * @param fn 被保护的异步函数
     * @returns 执行结果
     */
    execute<T>(componentName: string, fn: () => Promise<T>): Promise<T>;
    /**
     * 获取 Registry 实例——用于高级场景（如手动发射韧性事件）。
     */
    getRegistry(): Registry;
    /**
     * 设置韧性事件监听器——将 Registry 事件转发到遥测。
     */
    private _setupEventListeners;
}
/**
 * 全局韧性策略工厂单例——引擎启动时初始化。
 */
export declare const resilienceFactory: ResiliencePolicyFactory;
//# sourceMappingURL=resilience-integration.d.ts.map