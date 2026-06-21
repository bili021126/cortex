/**
 * mini-agent-pool.ts — 轻量级 AgentPool 实现
 *
 * 用于 CLI 轻量模式，提供 IAgentPool 接口的最小兼容实现。
 * 不参与 PipelineObserver 事件总线，仅管理 Agent 注册和状态。
 *
 * @since v3 — CLI 单次模式资源管理
 */
import { AgentStatus, type AgentConfig, type AgentType } from "@cortex/shared";
import type { IAgentPool } from "@cortex/scheduler";
export declare class MiniAgentPool implements IAgentPool {
    private configs;
    private instances;
    private statuses;
    register(config: AgentConfig): void;
    setMaxInstances(agentType: AgentType, newMax: number): void;
    setObserver(_observer: unknown): void;
    spawn(agentType: AgentType, instanceId: string): boolean;
    /** RLM 子任务——不占主配额 */
    spawnSubtask(agentType: AgentType, instanceId: string): boolean;
    setStatus(instanceId: string, status: AgentStatus): boolean;
    getStatuses(agentType: AgentType): AgentStatus[];
    getStatus(instanceId: string): AgentStatus | undefined;
    hasAwake(agentType: string): boolean;
    canSpawn(agentType: string): boolean;
    destroy(agentType: AgentType, instanceId: string): void;
    count(agentType: string): number;
}
//# sourceMappingURL=mini-agent-pool.d.ts.map