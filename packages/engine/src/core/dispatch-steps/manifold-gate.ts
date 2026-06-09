/**
 * ManifoldGate —— mHC 流形约束门控。
 *
 * 灵感来自 DeepSeek mHC (Manifold-Constrained Hyper-Connections) 论文：
 * - 流形约束：同类型 Agent 并发数 ≤ maxInstances（类比 mHC 的双重随机矩阵约束）
 * - 恒等保持：保证节点不静默丢失——等待到超时，或优雅失败
 * - FIFO 公平：先到先服务，无饥饿
 *
 * 集成方式：
 * - SpawnStep: spawn 前 acquire(type)，失败时 release(type)
 * - CleanupStep: destroy 后 release(type)
 *
 * @since mHC-Constrained Dispatch Pipeline
 */

import { PipelineEventType, PipelinePriority, type AgentType, type IPipelineObserver } from "@cortex/shared";

/** 最大等待时间（ms），超时后节点标记失败而非无限等待 */
const DEFAULT_ACQUIRE_TIMEOUT_MS = 60_000;

/** 槽位获取成功回调（由 release 唤醒或 reset 清理） */
type SlotResolver = () => void;

/**
 * FIFO 等待队列条目——同时持有 onAcquired 回调和 Promise resolve，
 * 使 reset() 可安全 resolve(false) 而不触发假获取。
 */
interface WaiterEntry {
  /** 请求 ID——用于事件链路追踪 */
  requestId: string;
  /** 获取成功回调（release 时调用） */
  onAcquired: SlotResolver;
  /** Promise resolve——reset/drain 时直接 resolve(false) */
  resolve: (acquired: boolean) => void;
  /** 超时定时器 ID */
  timeoutId: ReturnType<typeof setTimeout>;
}

interface GateState {
  /** 当前活跃数 */
  active: number;
  /** 等待队列（FIFO） */
  waiters: WaiterEntry[];
  /** drain 模式下拒绝新 acquire */
  draining?: boolean;
}

/**
 * ManifoldGate —— 全局单例流约束门控。
 *
 * 设计决策：使用静态 Map 而非实例，因为：
 * 1. Scheduler 单例运行期间只存在一个调度循环
 * 2. SpawnStep/CleanupStep 通过 dispatch 管道自然串行化
 * 3. 无需跨 Scheduler 实例共享状态
 */
export class ManifoldGate {
  private static _gates = new Map<string, GateState>();
  private static _maxByType = new Map<string, number>();
  private static _observer: IPipelineObserver | null = null;
  private static _requestSeq = 0;

  /** 生成唯一 requestId——格式 mg-{seq}-{timestamp36} */
  private static _nextRequestId(): string {
    ManifoldGate._requestSeq++;
    return `mg-${ManifoldGate._requestSeq}-${Date.now().toString(36)}`;
  }

  /**
   * 注入 PipelineObserver（用于上报流控事件）。
   * 在 Scheduler 构造后由 bootstrap/CLI 调用。
   */
  static setObserver(observer: IPipelineObserver): void {
    ManifoldGate._observer = observer;
  }

  /**
   * 注册 AgentType 的最大并发数（由 AgentPool.register 同步调用）。
   * maxInstances 必须 > 0，否则降级为 1（防御性默认）。
   */
  static register(agentType: string, maxInstances: number): void {
    const safeMax = maxInstances > 0 ? maxInstances : 1;
    ManifoldGate._maxByType.set(agentType, safeMax);
    if (!ManifoldGate._gates.has(agentType)) {
      ManifoldGate._gates.set(agentType, { active: 0, waiters: [] });
    }
  }

  /**
   * 热更新 AgentType 的最大并发数。
   * 若 newMax < 当前 active，多余槽位在后续 release 时自然回收。
   */
  static updateMax(agentType: string, newMax: number): void {
    if (newMax <= 0) {
      ManifoldGate._emitInvariant(agentType, `updateMax: newMax=${newMax} ≤ 0, rejected`);
      return;
    }
    ManifoldGate._maxByType.set(agentType, newMax);
    // 确保 gate 存在
    if (!ManifoldGate._gates.has(agentType)) {
      ManifoldGate._gates.set(agentType, { active: 0, waiters: [] });
    }
    // 若新上限更高且有待唤醒者，立即释放
    const gate = ManifoldGate._gates.get(agentType);
    if (!gate) return;
    while (gate.active < newMax && gate.waiters.length > 0) {
      const next = gate.waiters.shift();
      if (!next) break;
      clearTimeout(next.timeoutId);
      next.onAcquired();
    }
  }

  /**
   * 获取当前活跃实例数。
   */
  static active(agentType: string): number {
    return ManifoldGate._gates.get(agentType)?.active ?? 0;
  }

  /**
   * 获取等待队列长度。
   */
  static waiting(agentType: string): number {
    return ManifoldGate._gates.get(agentType)?.waiters.length ?? 0;
  }

  /**
   * 获取最大并发数。
   */
  static max(agentType: string): number {
    return ManifoldGate._maxByType.get(agentType) ?? 1;
  }

  /**
   * 获取执行槽位。
   *
   * - 当前活跃 < maxInstances → 立即返回
   * - 当前活跃 ≥ maxInstances → FIFO 排队等待，最长等 acquireTimeoutMs
   * - 超时 → 返回 false（调用方应将节点标记失败）
   *
   * @param agentType Agent 类型
   * @param acquireTimeoutMs 超时（默认 60s）
   * @returns true=获得槽位, false=超时或系统重置
   */
  static async acquire(
    agentType: AgentType | string,
    acquireTimeoutMs: number = DEFAULT_ACQUIRE_TIMEOUT_MS,
  ): Promise<boolean> {
    const max = ManifoldGate._maxByType.get(agentType) ?? 1;

    // max≤0 意味着该类型 Agent 无可用槽位——直接拒绝，不排队
    if (max <= 0) {
      return false;
    }

    let gate = ManifoldGate._gates.get(agentType);
    if (!gate) {
      gate = { active: 0, waiters: [] };
      ManifoldGate._gates.set(agentType, gate);
    }

    // drain 模式下拒绝新请求
    if (gate.draining) {
      return false;
    }

    // 槽位充足 → 立即获取
    if (gate.active < max) {
      gate.active++;
      return true;
    }

    // 槽位已满 → 排队等待（FIFO）
    const requestId = ManifoldGate._nextRequestId();
    ManifoldGate._emitWaitStart(agentType, gate.waiters.length + 1, requestId);

    const capturedGate = gate;
    return await new Promise<boolean>((resolve) => {
      const onAcquired: SlotResolver = () => {
        capturedGate.active++;
        ManifoldGate._emitWaitEnd(agentType, capturedGate.waiters.length, requestId);
        resolve(true);
      };

      // 超时处理
      const timeoutId = setTimeout(() => {
        // 从等待队列移除
        const idx = capturedGate.waiters.findIndex((w) => w.requestId === requestId);
        if (idx >= 0) {
          capturedGate.waiters.splice(idx, 1);
        }
        ManifoldGate._emitWaitTimeout(agentType, acquireTimeoutMs, requestId);
        resolve(false);
      }, acquireTimeoutMs);

      capturedGate.waiters.push({ requestId, onAcquired, resolve, timeoutId });
    });
  }

  /**
   * 释放执行槽位，唤醒下一个等待者（FIFO）。
   */
  static release(agentType: AgentType | string): void {
    const gate = ManifoldGate._gates.get(agentType);
    if (!gate) {
      ManifoldGate._emitReleaseOrphan(agentType);
      return;
    }

    if (gate.active > 0) {
      gate.active--;
    } else {
      ManifoldGate._emitInvariant(agentType, "release called with active=0 (possible double-release)");
    }

    const requestId = ManifoldGate._nextRequestId();
    ManifoldGate._emitReleased(agentType, gate.active, gate.waiters.length, requestId);

    // FIFO 唤醒下一个等待者
    if (gate.waiters.length > 0) {
      const next = gate.waiters.shift();
      if (!next) return;
      clearTimeout(next.timeoutId);
      next.onAcquired();
    }
  }

  /**
   * 重置所有门控状态（测试用）。
   * 清理所有定时器，resolve 所有等待 Promise 为 false。
   */
  static reset(): void {
    for (const gate of ManifoldGate._gates.values()) {
      // 清理所有超时定时器
      for (const waiter of gate.waiters) {
        clearTimeout(waiter.timeoutId);
        // resolve(false) 而非 reject——调用方应由 acquire 返回 false 优雅处理
        waiter.resolve(false);
      }
      gate.waiters.length = 0;
    }
    ManifoldGate._gates.clear();
    ManifoldGate._maxByType.clear();
    ManifoldGate._observer = null;
  }

  /**
   * 优雅关闭指定类型的门控。
   * 拒绝新的 acquire，等待所有活跃任务完成，resolve 所有等待者。
   */
  static async drain(agentType: string): Promise<void> {
    const gate = ManifoldGate._gates.get(agentType);
    if (!gate) return;

    gate.draining = true;

    // 拒绝所有等待者
    for (const waiter of gate.waiters) {
      clearTimeout(waiter.timeoutId);
      waiter.resolve(false);
    }
    gate.waiters.length = 0;

    // 等待所有活跃任务释放（轮询，最多等 30s）
    const maxWaitMs = 30_000;
    const pollIntervalMs = 200;
    const start = Date.now();
    while (gate.active > 0 && Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }

  // ── 事件上报 ──────────────────────────────────

  private static _emitWaitStart(agentType: string, queuePosition: number, requestId: string): void {
    ManifoldGate._observer?.emit({
      type: PipelineEventType.ManifoldGateWaitStart,
      priority: PipelinePriority.HIGH,
      payload: {
        agentType,
        queuePosition,
        active: ManifoldGate._gates.get(agentType)?.active ?? 0,
        max: ManifoldGate._maxByType.get(agentType) ?? 1,
        requestId,
      },
      timestamp: Date.now(),
      notificationType: "FYI",
    });
  }

  private static _emitWaitEnd(agentType: string, remainingWaiters: number, requestId: string): void {
    ManifoldGate._observer?.emit({
      type: PipelineEventType.ManifoldGateWaitEnd,
      priority: PipelinePriority.HIGH,
      payload: {
        agentType,
        remainingWaiters,
        requestId,
      },
      timestamp: Date.now(),
    });
  }

  private static _emitWaitTimeout(agentType: string, timeoutMs: number, requestId: string): void {
    ManifoldGate._observer?.emit({
      type: PipelineEventType.ManifoldGateAcquireTimeout,
      priority: PipelinePriority.HIGH,
      payload: {
        agentType,
        timeoutMs,
        requestId,
      },
      timestamp: Date.now(),
      notificationType: "WARNING",
    });
  }

  private static _emitReleased(agentType: string, active: number, waiting: number, requestId: string): void {
    ManifoldGate._observer?.emit({
      type: PipelineEventType.ManifoldGateReleased,
      priority: PipelinePriority.HIGH,
      payload: {
        agentType,
        active,
        waiting,
        requestId,
      },
      timestamp: Date.now(),
    });
  }

  private static _emitInvariant(agentType: string, message: string): void {
    ManifoldGate._observer?.emit({
      type: PipelineEventType.ManifoldGateInvariantViolation,
      priority: PipelinePriority.HIGH,
      payload: {
        agentType,
        message,
      },
      timestamp: Date.now(),
      notificationType: "WARNING",
    });
  }

  private static _emitReleaseOrphan(agentType: string): void {
    ManifoldGate._observer?.emit({
      type: PipelineEventType.ManifoldGateReleaseOrphan,
      priority: PipelinePriority.HIGH,
      payload: {
        agentType,
        message: `release called on unregistered or reset agentType: ${agentType}`,
      },
      timestamp: Date.now(),
    });
  }
}
