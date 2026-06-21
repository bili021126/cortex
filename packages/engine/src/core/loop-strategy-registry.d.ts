import type { TaskNode } from "@cortex/shared";
import type { IStep } from "@cortex/scheduler";
/**
 * 循环策略定义——描述一个可插拔的执行策略。
 */
export interface LoopStrategy {
    /** 策略名——对应 TaskNode.preferredStrategy 和 resolvePipeline 的 case */
    name: "react" | "direct" | "decompose" | "jury";
    /** 人类可读描述——给 MetaAgent/策略顾问看的 */
    description: string;
    /** 规则路由：返回 true 表示此策略适合处理该任务 */
    canHandle: (task: TaskNode) => boolean;
    /** 对应的管道步骤 */
    pipeline: IStep[];
}
/**
 * 循环策略注册表——策略选择和顾问上下文的单一真相源。
 *
 * 三条使用路径：
 *   1. 规则路由（零 LLM 成本）：selectByRule(task) → 匹配第一个 canHandle 为 true 的策略
 *   2. 策略顾问（LLM 辅助）：getAdvisorContext() → 注入 MetaAgent prompt
 *   3. 直接查询：get(name) → 查询单个策略定义
 */
export declare class LoopStrategyRegistry {
    private map;
    register(s: LoopStrategy): void;
    /** 规则路由——按注册顺序匹配，返回第一个 canHandle 为 true 的策略 */
    selectByRule(task: TaskNode): LoopStrategy | null;
    /** 给策略顾问用的上下文文本——可直接注入 MetaAgent prompt */
    getAdvisorContext(): string;
    /** 查询单个策略 */
    get(name: string): LoopStrategy | undefined;
    /** 所有已注册策略名 */
    list(): string[];
}
export declare const loopStrategyRegistry: LoopStrategyRegistry;
//# sourceMappingURL=loop-strategy-registry.d.ts.map