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

export class MiniAgentPool implements IAgentPool {
  private configs = new Map<string, AgentConfig>();
  private instances = new Map<string, Set<string>>();
  private statuses = new Map<string, AgentStatus>();

  register(config: AgentConfig): void {
    this.configs.set(config.type, config);
    if (!this.instances.has(config.type)) {
      this.instances.set(config.type, new Set());
    }
  }

  setMaxInstances(agentType: AgentType, newMax: number): void {
    const config = this.configs.get(agentType);
    if (config) config.maxInstances = newMax;
  }

  setObserver(_observer: unknown): void {
    // no-op: MiniAgentPool 不参与事件总线
  }

  spawn(agentType: AgentType, instanceId: string): boolean {
    const config = this.configs.get(agentType);
    if (!config) return false;
    const instances = this.instances.get(agentType);
    if (!instances) return false;
    if (instances.size >= (config.maxInstances ?? 1)) return false;
    instances.add(instanceId);
    this.statuses.set(instanceId, AgentStatus.Created);
    return true;
  }

  /** RLM 子任务——不占主配额 */
  spawnSubtask(agentType: AgentType, instanceId: string): boolean {
    const config = this.configs.get(agentType);
    if (!config) return false;
    const instances = this.instances.get(agentType);
    if (!instances) return false;
    instances.add(instanceId);
    this.statuses.set(instanceId, AgentStatus.Created);
    return true;
  }

  setStatus(instanceId: string, status: AgentStatus): boolean {
    if (!this.statuses.has(instanceId)) return false;
    this.statuses.set(instanceId, status);
    return true;
  }

  getStatuses(agentType: AgentType): AgentStatus[] {
    const instances = this.instances.get(agentType);
    if (!instances) return [];
    return [...instances].map((id) => this.statuses.get(id) ?? AgentStatus.Created);
  }

  getStatus(instanceId: string): AgentStatus | undefined {
    return this.statuses.get(instanceId);
  }

  hasAwake(agentType: AgentType): boolean {
    const instances = this.instances.get(agentType);
    if (!instances) return false;
    return [...instances].some((id) => this.statuses.get(id) === AgentStatus.Awake);
  }

  canSpawn(agentType: AgentType): boolean {
    const config = this.configs.get(agentType as AgentType);
    if (!config) return false;
    const instances = this.instances.get(agentType);
    if (!instances) return true;
    return instances.size < (config.maxInstances ?? 1);
  }

  destroy(agentType: AgentType, instanceId: string): void {
    const instances = this.instances.get(agentType);
    instances?.delete(instanceId);
    this.statuses.delete(instanceId);
  }

  count(agentType: AgentType): number {
    return this.instances.get(agentType)?.size ?? 0;
  }

  /** 记录 agent 心跳 */
  heartbeat(_agentId: string): void {
    // no-op: MiniAgentPool 不做心跳追踪
  }

  /** 探测 agent 是否存活 */
  async ping(agentId: string): Promise<boolean> {
    return this.statuses.has(agentId);
  }
}
