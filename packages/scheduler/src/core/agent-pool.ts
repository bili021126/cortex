import { AgentStatus, PipelineEventType, PipelinePriority, type AgentConfig, type AgentType, type IPipelineObserver, type InvariantReporter, type ISchedulerAgentPool, type IAgentPool } from "@cortex/shared";
import { isTestEnv } from "@cortex/config";
import { ManifoldGate } from "../dispatch-steps/manifold-gate.js";

/**
 * ISchedulerAgentPool / IAgentPool —— 契约已上迁至 @cortex/shared。
 * 本处 re-export 以兼容旧消费方（@cortex/scheduler）。
 * 新消费方应从 @cortex/shared 导入。
 */
export type { ISchedulerAgentPool, IAgentPool };

/**
 * AgentPool —— Agent 生命周期管理 + 状态机追踪
 * 每种 Agent 类型保留至少 1 个实例配额，防饥饿。
 * 状态流转：Created → Awake → Active → Awake → ... → Draining → Destroyed
 *
 * 方案B：AgentPool 为 Agent 状态的唯一权威源。
 * Agent.status 改为只读 getter，委托到 Pool。
 * 常规写路径通过 setStatus()（含合法性校验），spawn/destroy 在边界条件下直接写入（Created/Destroyed）。
 */
export class AgentPool implements IAgentPool {
  private configs = new Map<AgentType, AgentConfig>();
  private active = new Map<AgentType, Set<string>>();
  private statuses = new Map<string, AgentStatus>(); // instanceId → status
  private heartbeats = new Map<string, number>(); // instanceId → lastHeartbeat
  /** M6 fix: 反向索引 instanceId → type，使 ping() 从 O(n·m) 降为 O(1) */
  private readonly _activeByInstance = new Map<string, AgentType>();
  /** P1-B3: 子任务独立集合——不占主配额，不计入 maxInstances */
  private readonly _subtaskInstances = new Map<AgentType, Set<string>>();
  private _observer?: IPipelineObserver;

  /**
   * invariant 违规上报后端。
   * 默认为 `null`（末尾兜底 console.error）。
   * 在 bootstrap 中注入 observer.emit 后，所有状态机违规会走 observer 管道。
   *
   * 优先级：实例 _observer > 静态 onInvariant > console.error
   */
  static onInvariant: InvariantReporter | null = null;

  /** 注入 PipelineObserver（与 onInvariant 互补的双通道模式） */
  setObserver(observer: IPipelineObserver): void {
    this._observer = observer;
    // mHC 流形约束：注入 observer 用于流控事件上报
    ManifoldGate.setObserver(observer);
  }

  /** 合法状态流转表
   *  Active → Active 允许作为无操作：调度器可能对同一实例并发分发任务，
   *  已激活的 agent 再次执行时无需变更状态，静默通过即可。 */
  static readonly VALID_TRANSITIONS: Record<AgentStatus, Set<AgentStatus>> = {
    [AgentStatus.Created]: new Set([AgentStatus.Awake, AgentStatus.Destroyed]),
    [AgentStatus.Awake]: new Set([AgentStatus.Active, AgentStatus.Draining]),
    [AgentStatus.Active]: new Set([AgentStatus.Awake, AgentStatus.Draining, AgentStatus.Active]),
    [AgentStatus.Draining]: new Set([AgentStatus.Destroyed]),
    [AgentStatus.Destroyed]: new Set([]),
  };

  register(config: AgentConfig): void {
    this.configs.set(config.type, config);
    if (!this.active.has(config.type)) {
      this.active.set(config.type, new Set());
    }
    // mHC 流形约束注册：同步 ManifoldGate 的 maxInstances
    ManifoldGate.register(config.type, config.maxInstances ?? 1);
  }

  /**
   * 动态更新 AgentType 的最大并发数（热扩容/缩容）。
   * 同步更新本地 configs 和 ManifoldGate 流控上限。
   */
  setMaxInstances(agentType: AgentType, newMax: number): void {
    const config = this.configs.get(agentType);
    if (config) {
      config.maxInstances = newMax;
    }
    ManifoldGate.updateMax(agentType, newMax);
  }

  /** 启动一个 Agent 实例。超限或 instanceId 重复返回 false。新实例初始状态为 Created。 */
  spawn(agentType: AgentType, instanceId: string): boolean {
    const config = this.configs.get(agentType);
    if (!config) return false;
    // 防重复 spawn：instanceId 已存在时拒绝，防止重置已运行 agent 状态
    if (this.statuses.has(instanceId)) return false;
    const instances = this.active.get(agentType);
    if (!instances) return false;
    if (instances.size >= (config.maxInstances ?? 1)) return false;
    instances.add(instanceId);
    this._activeByInstance.set(instanceId, agentType);
    this.statuses.set(instanceId, AgentStatus.Created);
    return true;
  }

  /**
   * 生成 RLM 子任务实例——不占主配额，不计入 maxInstances。
   * 子任务与父任务共享同一 Agent 类型，但不应受池子限制。
   * 使用场景：MetaAgent replan 产生的子任务、RLM ExecuteStep 拆解的 SubTask。
   */
  spawnSubtask(agentType: AgentType, instanceId: string): boolean {
    const config = this.configs.get(agentType);
    if (!config) return false;
    // P1-B3①: 防重复 id——同 spawn 一致的防御
    if (this.statuses.has(instanceId)) return false;
    // P1-B3②: 子任务用独立集合，不占 active 主配额
    let instances = this._subtaskInstances.get(agentType);
    if (!instances) {
      instances = new Set();
      this._subtaskInstances.set(agentType, instances);
    }
    instances.add(instanceId);
    // P1-B3③: 补 _activeByInstance 使 ping() 能探测到
    this._activeByInstance.set(instanceId, agentType);
    this.statuses.set(instanceId, AgentStatus.Created);
    return true;
  }

  /** 更新实例状态（含流转合法性校验）。成功返回 true，非法流转返回 false。 */
  setStatus(instanceId: string, status: AgentStatus): boolean {
    const current = this.statuses.get(instanceId);
    if (current === undefined) return false;
    const allowed = AgentPool.VALID_TRANSITIONS[current];
    if (!allowed.has(status)) {
      const msg = `非法流转 ${current} → ${status} (instance: ${instanceId})`;
      this._reportInvariant("AgentPool.setStatus", msg, { instanceId, current, attempted: status });
      return false;
    }
    this.statuses.set(instanceId, status);
    return true;
  }

  /** 获取某类型下所有实例的状态列表 */
  getStatuses(agentType: AgentType): AgentStatus[] {
    const instances = this.active.get(agentType);
    if (!instances) return [];
    return [...instances].map((id) => this.statuses.get(id) ?? AgentStatus.Created);
  }

  /** 获取单个实例的状态 */
  getStatus(instanceId: string): AgentStatus | undefined {
    return this.statuses.get(instanceId);
  }

  /** 检查某类型是否有 Awake 状态的实例 */
  hasAwake(agentType: AgentType): boolean {
    const instances = this.active.get(agentType);
    if (!instances) return false;
    return [...instances].some((id) => this.statuses.get(id) === AgentStatus.Awake);
  }

  /** 回收 Agent 实例 */
  destroy(agentType: AgentType, instanceId: string): void {
    const current = this.statuses.get(instanceId);
    if (current === undefined || current === AgentStatus.Destroyed) {
      this.active.get(agentType)?.delete(instanceId);
      this._subtaskInstances.get(agentType)?.delete(instanceId);
      this._activeByInstance.delete(instanceId);
      return;
    }

    const ok = this.setStatus(instanceId, AgentStatus.Destroyed);
    if (!ok) {
      const violation = {
        source: "AgentPool.destroy",
        message: `destroy 绕过状态机: ${current} → Destroyed`,
        details: { instanceId, agentType },
      };
      this.statuses.set(instanceId, AgentStatus.Destroyed); // 核选项：绕过状态机强制终结（Active→Destroyed 不在合法流转表中）
      this._reportInvariant("AgentPool.destroy", violation.message, violation.details);
    }
    this.active.get(agentType)?.delete(instanceId);
    this._subtaskInstances.get(agentType)?.delete(instanceId);
    this._activeByInstance.delete(instanceId);
    this.statuses.delete(instanceId);
  }

  /** 某类型还有可用配额？ */
  canSpawn(agentType: AgentType): boolean {
    const config = this.configs.get(agentType);
    if (!config) return false;
    const instances = this.active.get(agentType);
    if (!instances) return false;
    return instances.size < (config.maxInstances ?? 1);
  }

  /** 某类型当前实例数 */
  count(agentType: AgentType): number {
    return this.active.get(agentType)?.size ?? 0;
  }

  /**
   * 统一 invariant 上报通道。
   * 优先级：_observer > onInvariant > console.error
   * 单通道收敛，消除双路径重复 emit 风险。
   */
  private _reportInvariant(source: string, message: string, details?: unknown): void {
    if (this._observer) {
      this._observer.emit({
        type: PipelineEventType.AgentPoolInvariantViolation,
        priority: PipelinePriority.CRITICAL,
        payload: { source, detail: details !== undefined ? `${message} | ${JSON.stringify(details)}` : message },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    } else if (AgentPool.onInvariant) {
      AgentPool.onInvariant({ source, message, details });
    } else if (!isTestEnv()) {
      console.error(`[invariant] ${source}: ${message}`);
    }
  }

  /** 记录 agent 心跳——更新最后活跃时间戳。 */
  heartbeat(agentId: string): void {
    this.heartbeats.set(agentId, Date.now());
  }

  /**
   * 探测 agent 是否存活。
   * 检查 agent 实例是否仍在 pool 的活跃列表中。
   */
  async ping(agentId: string): Promise<boolean> {
    // M6 fix: O(1) 反向索引查找，替代 O(n·m) 遍历所有活跃集合
    return this._activeByInstance.has(agentId);
  }

  /** 检测心跳超时，返回超时秒数（-1 表示正常或无心跳记录） */
  staleSeconds(agentId: string, maxStaleMs: number): number {
    const lastHb = this.heartbeats.get(agentId);
    if (!lastHb) return -1;
    const elapsed = Date.now() - lastHb;
    return elapsed > maxStaleMs ? elapsed / 1000 : -1;
  }

  /** 池统计——用于遥测和监控
   * Core-2 动态扩缩在此扩展——当前仅统计不变更实例数 */
  getPoolStats(): { total: number; idle: number; busy: number; idleRate: number } {
    let idle = 0;
    let total = 0;
    for (const [, instanceIds] of this.active) {
      for (const id of instanceIds) {
        total++;
        const status = this.statuses.get(id);
        if (status === AgentStatus.Awake) idle++;
      }
    }
    return {
      total,
      idle,
      busy: total - idle,
      idleRate: total > 0 ? idle / total : 0,
    };
  }
}
