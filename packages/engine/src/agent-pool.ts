import type { AgentType, AgentConfig, InvariantReporter } from "@cortex/shared";
import type { PipelineObserver } from "./pipeline-observer.js";
import { AgentStatus, PipelineEventType, PipelinePriority } from "@cortex/shared";
import { isTestEnv } from "./test-env.js";

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
export class AgentPool {
  private configs = new Map<AgentType, AgentConfig>();
  private active = new Map<AgentType, Set<string>>();
  private statuses = new Map<string, AgentStatus>(); // instanceId → status
  private _observer?: PipelineObserver;

  /**
   * invariant 违规上报后端。
   * 默认为 `null`（仅 console.error）。
   * 在 bootstrap 中注入 observer.emit 后，所有状态机违规会走 observer 管道。
   *
   * 优先级：实例 _observer > 静态 onInvariant > console.error
   *
   * 类型来源：@cortex/shared InvariantReporter（与 TaskBoard 共享同一签名）
   * @migrated-from 内联回调签名 → shared InvariantReporter (P1 — 艾尔海森类型迁移计划)
   */
  static onInvariant: InvariantReporter | null = null;

  /** 注入 PipelineObserver（与 onInvariant 互补的双通道模式） */
  setObserver(observer: PipelineObserver): void {
    this._observer = observer;
  }

  /** 合法状态流转表（pool-aware.ts 共享引用，与 AgentPool 同源） */
  static readonly VALID_TRANSITIONS: Record<AgentStatus, Set<AgentStatus>> = {
    [AgentStatus.Created]: new Set([AgentStatus.Awake, AgentStatus.Destroyed]),
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
      this._reportInvariant("AgentPool.destroy", violation.message, violation.details);
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
