import { AgentStatus, PipelineEventType, PipelinePriority, type AgentConfig, type AgentType, type IPipelineObserver, type InvariantReporter } from "@cortex/shared";
import { isTestEnv } from "../test-env.js";
import { ManifoldGate } from "./dispatch-steps/manifold-gate.js";

/**
 * ISchedulerAgentPool —— Scheduler 依赖的 AgentPool 最小契约。
 * 提取此接口使 Scheduler 不依赖具体 AgentPool 实现，
 * 允许 CLI 侧 MiniAgentPool 在轻量模式下替代完整 AgentPool。
 */
export interface ISchedulerAgentPool {
  spawn(agentType: AgentType, instanceId: string): boolean;
  /** RLM 子任务——不占主配额 */
  spawnSubtask(agentType: AgentType, instanceId: string): boolean;
  getStatus(instanceId: string): AgentStatus | undefined;
  setStatus(instanceId: string, status: AgentStatus): boolean;
  destroy(agentType: AgentType, instanceId: string): void;
}

/**
 * IAgentPool —— AgentPool 完整管理接口。
 * 扩展 ISchedulerAgentPool（Scheduler 最小依赖），补全管理端方法。
 * @since v2.8 核心组件接口化与组合式重构
 */
export interface IAgentPool extends ISchedulerAgentPool {
  register(config: AgentConfig): void;
  /** 动态调整 AgentType 最大并发数（热扩容/缩容） */
  setMaxInstances(agentType: AgentType, newMax: number): void;
  setObserver(observer: IPipelineObserver): void;
  getStatuses(agentType: AgentType): AgentStatus[];
  hasAwake(agentType: AgentType): boolean;
  canSpawn(agentType: AgentType): boolean;
  count(agentType: AgentType): number;
}

/**
 * AgentPool —— Agent 生命周期管理 + 状态机追踪
 * 每种 Agent 类型保留至少 1 个实例配额，防饥饿。
 * 状态流转：Created → Awake → Active → Awake → ... → Draining → Destroyed
 *
 * 方案B：AgentPool 为 Agent 状态的唯一权威源。
 * Agent.status 改为只读 getter，委托到 Pool；写路径仅通过 Pool.setStatus()。
 *
 * @fix D6 — invariant 上报单通道收敛：_observer 实例优先于 onInvariant 静态字段，
 *   消除静动态优先级不明确的问题。destroy() 中避免双路径重复 emit。
 */
export class AgentPool implements IAgentPool {
  private configs = new Map<AgentType, AgentConfig>();
  private active = new Map<AgentType, Set<string>>();
  private statuses = new Map<string, AgentStatus>(); // instanceId → status
  private _observer?: IPipelineObserver;

  /**
   * invariant 违规上报后端。
   * 默认为 `null`（末尾兜底 console.error）。
   * 在 bootstrap 中注入 observer.emit 后，所有状态机违规会走 observer 管道。
   *
   * 优先级：实例 _observer > 静态 onInvariant > console.error（最后防线——无任何上报通道时的硬兜底）
   *
   * @justification 原则五豁免——console.error 在无 observer 且无 onInvariant 时作为唯一可用的紧急告警通道。
   *   正常运行时 observer 必然已注入，此分支仅在 bootstrap 早期阶段或严重配置错误时触发。
   *
   * 类型来源：@cortex/shared InvariantReporter（与 TaskBoard 共享同一签名）
   * @migrated-from 内联回调签名 → shared InvariantReporter (P1 — 艾尔海森类型迁移计划)
   */
  static onInvariant: InvariantReporter | null = null;

  /** 注入 PipelineObserver（与 onInvariant 互补的双通道模式） */
  setObserver(observer: IPipelineObserver): void {
    this._observer = observer;
    // mHC 流形约束：注入 observer 用于流控事件上报
    ManifoldGate.setObserver(observer);
  }

  /** 合法状态流转表（pool-aware.ts 共享引用，与 AgentPool 同源）
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

  /** 启动一个 Agent 实例。超限返回 false。新实例初始状态为 Created。 */
  spawn(agentType: AgentType, instanceId: string): boolean {
    const config = this.configs.get(agentType);
    if (!config) return false;
    const instances = this.active.get(agentType);
    if (!instances) return false;
    if (instances.size >= (config.maxInstances ?? 1)) return false;
    instances.add(instanceId);
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
    const instances = this.active.get(agentType);
    if (!instances) return false;
    instances.add(instanceId);
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

  /** 回收 Agent 实例。优先走 setStatus() 状态机流转；仅当非法流转（如崩溃后强制回收）时直写 Map 兜底。
   *
   * 治理判例 NG-2026-0511-Destroy-Bypass：
   * 绕过状态机的直写路径须经 observer 管道上报，不得仅 console.warn。 */
  destroy(agentType: AgentType, instanceId: string): void {
    const current = this.statuses.get(instanceId);
    if (current === undefined || current === AgentStatus.Destroyed) {
      this.active.get(agentType)?.delete(instanceId);
      return;
    }

    const ok = this.setStatus(instanceId, AgentStatus.Destroyed);
    if (!ok) {
      const violation = {
        source: "AgentPool.destroy",
        message: `destroy 绕过状态机: ${current} → Destroyed`,
        details: { instanceId, agentType },
      };
      // @fix P0-2 — 先 setStatus 写状态，再 emit 上报：emit 抛异常不破坏已写入的状态
      this.statuses.set(instanceId, AgentStatus.Destroyed);
      this._reportInvariant("AgentPool.destroy", violation.message, violation.details);
    }
    this.active.get(agentType)?.delete(instanceId);
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
        payload: { source, message, detail: JSON.stringify(details ?? {}) },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    } else if (AgentPool.onInvariant) {
      AgentPool.onInvariant({ source, message, details });
    } else if (!isTestEnv()) {
      console.error(`[invariant] ${source}: ${message}`);
    }
  }
}
