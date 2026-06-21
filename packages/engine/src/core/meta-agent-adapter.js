/**
 * MetaAgentReplanAdapter —— 将 MetaAgent 适配为 IReplanProvider 接口。
 *
 * 引擎的 MetaAgent 拥有具体的 requestReplan / requestBoundaryReplan 方法，
 * scheduler 的 ReplanManager 则依赖抽象的 IReplanProvider 接口。
 * 此适配器完成从具体类到接口的桥接，使引擎可以无缝使用 scheduler 的 ReplanManager。
 *
 * @since v3.x — engine 副本压扁：删除本地 ReplanManager，统一用 @cortex/scheduler
 */
export class MetaAgentReplanAdapter {
    metaAgent;
    constructor(metaAgent) {
        this.metaAgent = metaAgent;
    }
    async requestReplan(node, reason, count, _currentDepth, maxReplanPerNode) {
        return await this.metaAgent.requestReplan(node, reason, count, undefined, maxReplanPerNode);
    }
    async requestBoundaryReplan(node, reason, count, _currentDepth, maxReplanPerNode) {
        return await this.metaAgent.requestBoundaryReplan(node, reason, count, undefined, maxReplanPerNode);
    }
}
//# sourceMappingURL=meta-agent-adapter.js.map