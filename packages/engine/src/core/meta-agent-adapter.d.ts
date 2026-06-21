/**
 * MetaAgentReplanAdapter —— 将 MetaAgent 适配为 IReplanProvider 接口。
 *
 * 引擎的 MetaAgent 拥有具体的 requestReplan / requestBoundaryReplan 方法，
 * scheduler 的 ReplanManager 则依赖抽象的 IReplanProvider 接口。
 * 此适配器完成从具体类到接口的桥接，使引擎可以无缝使用 scheduler 的 ReplanManager。
 *
 * @since v3.x — engine 副本压扁：删除本地 ReplanManager，统一用 @cortex/scheduler
 */
import type { IReplanProvider } from "@cortex/scheduler";
import type { MetaAgent } from "./meta-agent.js";
export declare class MetaAgentReplanAdapter implements IReplanProvider {
    private readonly metaAgent;
    constructor(metaAgent: MetaAgent);
    requestReplan(node: Parameters<IReplanProvider["requestReplan"]>[0], reason: string, count: number, _currentDepth?: number, maxReplanPerNode?: number): ReturnType<IReplanProvider["requestReplan"]>;
    requestBoundaryReplan(node: Parameters<IReplanProvider["requestBoundaryReplan"]>[0], reason: string, count: number, _currentDepth?: number, maxReplanPerNode?: number): ReturnType<IReplanProvider["requestBoundaryReplan"]>;
}
//# sourceMappingURL=meta-agent-adapter.d.ts.map