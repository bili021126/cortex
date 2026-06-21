import type { TaskNode } from "@cortex/shared";
/**
 * 模型健康状态——运行时动态维护。
 */
export interface ModelHealth {
    /** 模型标识符 */
    model: string;
    /** 是否可用 */
    available: boolean;
    /** 最近一次失败时间戳 (ms) */
    lastFailureAt?: number;
    /** 连续失败次数 */
    consecutiveFailures: number;
    /** 平均延迟 (ms) */
    avgLatencyMs?: number;
}
/**
 * 环境感知路由配置。
 */
export interface EnvironmentRouterOptions {
    /** 模型优先级列表——按优先级降序排列，首个可用模型被选中 */
    modelPriority: string[];
    /** 降级策略——当首选模型不可用时的回退行为 */
    fallbackStrategy: "next-in-priority" | "cheapest" | "fastest";
    /** 健康检查冷却时间 (ms)——失败后多久重试，默认 60000 (1分钟) */
    healthCheckCooldownMs?: number;
    /** 连续失败阈值——超过此值标记为不可用，默认 3 */
    failureThreshold?: number;
    /** 最大延迟阈值 (ms)——超过此值视为不可用，默认 30000 */
    maxLatencyMs?: number;
}
/**
 * 环境感知路由器——根据运行时环境约束动态调整模型选择。
 *
 * 与 TaskRouter 的关系：
 *   - TaskRouter：基于任务语义选择策略+模型（"这个任务应该用什么"）
 *   - EnvironmentAwareRouter：基于环境约束调整模型（"现在能用什么"）
 *
 * 典型用法：
 *   ```typescript
 *   const envRouter = new EnvironmentAwareRouter({
 *     modelPriority: ["gpt-4o", "claude-3.5-sonnet", "gpt-4o-mini"],
 *     fallbackStrategy: "next-in-priority",
 *   });
 *
 *   // 包装 TaskRouter 的 route 方法
 *   const semanticDecision = await taskRouter.route(node, agentType);
 *   const finalModel = await envRouter.resolve(semanticDecision.model, node);
 *   ```
 */
export declare class EnvironmentAwareRouter {
    /** 模型健康状态表 */
    private readonly healthMap;
    /** 配置（含默认值） */
    private readonly config;
    constructor(options: EnvironmentRouterOptions);
    /**
     * 解析最终模型——根据环境约束调整语义路由的选择。
     *
     * 逻辑：
     *   1. 首选模型可用 → 直接返回
     *   2. 首选模型不可用 → 按 fallbackStrategy 选择备用模型
     *   3. 所有模型不可用 → 返回首选模型（强制重试，避免全链路失败）
     *
     * @param preferredModel 语义路由推荐的模型
     * @param node 任务节点（用于遥测标签）
     * @returns 最终选中的模型
     */
    resolve(preferredModel: string, node: TaskNode): Promise<string>;
    /**
     * 上报模型调用成功——更新健康状态。
     * @param model 模型标识符
     * @param latencyMs 本次调用延迟
     */
    reportSuccess(model: string, latencyMs: number): void;
    /**
     * 上报模型调用失败——更新健康状态，可能标记为不可用。
     * @param model 模型标识符
     */
    reportFailure(model: string): void;
    /**
     * 获取所有模型健康状态——用于可观测性。
     */
    getHealthSnapshot(): ModelHealth[];
    /**
     * 检查模型是否可用——考虑健康状态和冷却时间。
     */
    private isAvailable;
    /**
     * 选择降级模型——按 fallbackStrategy 从优先级列表中选取。
     */
    private _selectFallback;
    /**
     * 发射遥测数据——记录路由决策。
     */
    private _emitTelemetry;
}
//# sourceMappingURL=environment-aware-router.d.ts.map