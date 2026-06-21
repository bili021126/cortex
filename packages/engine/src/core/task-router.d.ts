import type { TaskNode } from "@cortex/shared";
import type { IModelRouter } from "@cortex/scheduler";
/**
 * 路由决策——TaskRouter.route() 的产出，统一描述策略+模型选择。
 */
export interface RouteDecision {
    /** 节点 ID */
    nodeId: string;
    /** 选中的循环策略 */
    strategy: "react" | "direct" | "decompose" | "jury";
    /** 策略选择来源 */
    strategySource: "meta-agent" | "rule-routing" | "fallback";
    /** 选中的模型 */
    model: string;
    /** 模型选择来源 */
    modelSource: "recommended" | "classifier" | "fallback";
    /** 路由耗时 (ms) */
    durationMs: number;
}
/**
 * 任务路由器——统一策略选择和模型选择。
 *
 * 现状问题：
 *   - 策略选择在 agent-factory (LoopStrategyRegistry.selectByRule)
 *   - 模型选择在 scheduler (IModelRouter.route)
 *   - 两处独立决策，无法联合优化
 *
 * 目标：
 *   将路由收敛为一次决策：strategy + model 同时确定。
 *   为将来的联合优化（如 "direct 策略总是用 fast 模型"）留出空间。
 */
export declare class TaskRouter {
    private readonly modelRouter;
    private readonly defaultModel;
    constructor(modelRouter: IModelRouter, defaultModel: string);
    /**
     * 路由决策——为给定节点选择策略和模型。
     *
     * 优先级：
     *   1. MetaAgent 已标注 → 直接用 (preferredStrategy + recommendedTier)
     *   2. 规则路由 → LoopStrategyRegistry.selectByRule() + modelRouter.route()
     *   3. Fallback → "react" + defaultModel
     *
     * @param node 任务节点
     * @param agentType Agent 类型
     * @returns 路由决策（strategy + model + 来源标注）
     */
    route(node: TaskNode, agentType: string): Promise<RouteDecision>;
    /**
     * 批量路由——为多个节点预计算路由决策。
     * 用于拓扑排序后的并行分发场景。
     */
    routeBatch(nodes: TaskNode[], agentType: string): Promise<Map<string, RouteDecision>>;
}
//# sourceMappingURL=task-router.d.ts.map