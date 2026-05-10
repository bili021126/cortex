import type { AgentType, AgentConfig } from "@cortex/shared";
import { AgentStatus } from "@cortex/shared";

/**
 * AgentPool —— Agent 生命周期管理 + 状态机追踪
 * 每种 Agent 类型保留至少 1 个实例配额，防饥饿。
 * 状态流转：Created → Awake → Active → Awake → ... → Draining → Destroyed
 *
 * 方案B：AgentPool 为 Agent 状态的唯一权威源。
 * Agent.status 改为只读 getter，委托到 Pool；写路径仅通过 Pool.setStatus()。
 */
export class AgentPool {
  private configs = new Map<AgentType, AgentConfig>();
  private active = new Map<AgentType, Set<string>>();
  private statuses = new Map<string, AgentStatus>(); // instanceId → status

  /**
   * invariant 违规上报后端。
   * 默认为 `null`（仅 console.error）。
   * 在 bootstrap 中注入 observer.emit 后，所有状态机违规会走 observer 管道。
   */
  static onInvariant: ((violation: { source: string; message: string; details?: unknown }) => void) | null = null;

  /** 合法状态流转表 */
  private static readonly VALID_TRANSITIONS: Record<AgentStatus, Set<AgentStatus>> = {
    [AgentStatus.Created]: new Set([AgentStatus.Awake]),
    [AgentStatus.Awake]: new Set([AgentStatus.Active, AgentStatus.Draining]),
    [AgentStatus.Active]: new Set([AgentStatus.Awake, AgentStatus.Draining]),
    [AgentStatus.Draining]: new Set([AgentStatus.Destroyed]),
    [AgentStatus.Destroyed]: new Set([]),
  };

  register(config: AgentConfig): void {
    this.configs.set(config.type, config);
    if (!this.active.has(config.type)) {
      this.active.set(config.type, new Set());
    }
  }

  /** 启动一个 Agent 实例。超限返回 false。新实例初始状态为 Created。 */
  spawn(agentType: AgentType, instanceId: string): boolean {
    const config = this.configs.get(agentType);
    if (!config) return false;
    const instances = this.active.get(agentType)!;
    if (instances.size >= config.maxInstances) return false;
    instances.add(instanceId);
    this.statuses.set(instanceId, AgentStatus.Created);
    return true;
  }

  /** 更新实例状态（含流转合法性校验） */
  setStatus(instanceId: string, status: AgentStatus): void {
    const current = this.statuses.get(instanceId);
    if (current === undefined) return;
    const allowed = AgentPool.VALID_TRANSITIONS[current];
    if (!allowed.has(status)) {
      const msg = `非法流转 ${current} → ${status} (instance: ${instanceId})`;
      if (AgentPool.onInvariant) {
        AgentPool.onInvariant({ source: "AgentPool.setStatus", message: msg, details: { instanceId, current, attempted: status } });
      } else {
        console.error(`[invariant] AgentPool.setStatus: ${msg}`);
      }
      return;
    }
    this.statuses.set(instanceId, status);
  }

  /** 获取某类型下所有实例的状态列表 */
  getStatuses(agentType: AgentType): AgentStatus[] {
    const instances = this.active.get(agentType);
    if (!instances) return [];
    return [...instances].map((id) => this.statuses.get(id) ?? AgentStatus.Created);
  }

  /** 获取单个实例的状态（方案B：Agent.status getter 委托至此） */
  getStatus(instanceId: string): AgentStatus | undefined {
    return this.statuses.get(instanceId);
  }

  /** 检查某类型是否有 Awake 状态的实例 */
  hasAwake(agentType: AgentType): boolean {
    const instances = this.active.get(agentType);
    if (!instances) return false;
    return [...instances].some((id) => this.statuses.get(id) === AgentStatus.Awake);
  }

  /** 回收 Agent 实例。绕过状态机校验直接清理——非法流转情况（如崩溃后强制回收）已在 warn 中记录。 */
  destroy(agentType: AgentType, instanceId: string): void {
    const current = this.statuses.get(instanceId);
    if (current !== undefined && current !== AgentStatus.Destroyed) {
      if (current !== AgentStatus.Draining) {
        console.warn(
          `[agent-pool] destroy 绕过状态机: ${current} → Destroyed (instance: ${instanceId})，强制清理`,
        );
      }
      // 直接置状态，不经过 setStatus——绕过流转校验，语义与"强制清理"一致
      this.statuses.set(instanceId, AgentStatus.Destroyed);
    }
    this.active.get(agentType)?.delete(instanceId);
    this.statuses.delete(instanceId);
  }

  /** 某类型还有可用配额？ */
  canSpawn(agentType: AgentType): boolean {
    const config = this.configs.get(agentType);
    if (!config) return false;
    const instances = this.active.get(agentType)!;
    return instances.size < config.maxInstances;
  }

  /** 某类型当前实例数 */
  count(agentType: AgentType): number {
    return this.active.get(agentType)?.size ?? 0;
  }
}
