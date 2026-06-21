/**
 * mini-agent-pool.ts — 轻量级 AgentPool 实现
 *
 * 用于 CLI 轻量模式，提供 IAgentPool 接口的最小兼容实现。
 * 不参与 PipelineObserver 事件总线，仅管理 Agent 注册和状态。
 *
 * @since v3 — CLI 单次模式资源管理
 */
import { AgentStatus } from "@cortex/shared";
export class MiniAgentPool {
    configs = new Map();
    instances = new Map();
    statuses = new Map();
    register(config) {
        this.configs.set(config.type, config);
        if (!this.instances.has(config.type)) {
            this.instances.set(config.type, new Set());
        }
    }
    setMaxInstances(agentType, newMax) {
        const config = this.configs.get(agentType);
        if (config)
            config.maxInstances = newMax;
    }
    setObserver(_observer) {
        // no-op: MiniAgentPool 不参与事件总线
    }
    spawn(agentType, instanceId) {
        const config = this.configs.get(agentType);
        if (!config)
            return false;
        const instances = this.instances.get(agentType);
        if (!instances)
            return false;
        if (instances.size >= (config.maxInstances ?? 1))
            return false;
        instances.add(instanceId);
        this.statuses.set(instanceId, AgentStatus.Created);
        return true;
    }
    /** RLM 子任务——不占主配额 */
    spawnSubtask(agentType, instanceId) {
        const config = this.configs.get(agentType);
        if (!config)
            return false;
        const instances = this.instances.get(agentType);
        if (!instances)
            return false;
        instances.add(instanceId);
        this.statuses.set(instanceId, AgentStatus.Created);
        return true;
    }
    setStatus(instanceId, status) {
        if (!this.statuses.has(instanceId))
            return false;
        this.statuses.set(instanceId, status);
        return true;
    }
    getStatuses(agentType) {
        const instances = this.instances.get(agentType);
        if (!instances)
            return [];
        return [...instances].map((id) => this.statuses.get(id) ?? AgentStatus.Created);
    }
    getStatus(instanceId) {
        return this.statuses.get(instanceId);
    }
    hasAwake(agentType) {
        const instances = this.instances.get(agentType);
        if (!instances)
            return false;
        return [...instances].some((id) => this.statuses.get(id) === AgentStatus.Awake);
    }
    canSpawn(agentType) {
        const config = this.configs.get(agentType);
        if (!config)
            return false;
        const instances = this.instances.get(agentType);
        if (!instances)
            return true;
        return instances.size < (config.maxInstances ?? 1);
    }
    destroy(agentType, instanceId) {
        const instances = this.instances.get(agentType);
        instances?.delete(instanceId);
        this.statuses.delete(instanceId);
    }
    count(agentType) {
        return this.instances.get(agentType)?.size ?? 0;
    }
}
//# sourceMappingURL=mini-agent-pool.js.map