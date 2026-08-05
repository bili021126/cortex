/**
 * AgentTracker —— Agent 执行状态跟踪与分层超时检测。
 *
 * 职责：
 * 1. 跟踪 agent 从 dispatch → executing → completed/failed/timedout 的状态机
 * 2. 三层超时检测：L1 warn（60s） → L2 ping（90s） → L3 dead（120s）
 * 3. 产出 TimeoutAction[] 供调用方（Scheduler driver）分发处理
 *
 * @since scheduler-heartbeat-refactoring
 */

// ── 常量 ────────────────────────────────────────────────────

/** L1：超时警告阈值（60s）——emit Exec:NodeDelayed (warn) */
const L1_WARN_MS = 60_000;
/** L2：探测阈值（90s）——ping agent + emit Exec:NodeDelayed (extend) */
const L2_PING_MS = 90_000;
/** L3：判定死亡阈值（360s——R13：此前 120s < race 300s，执行中 120s+ 被 kill 误杀合法慢执行；recordHeartbeat 未接线时 lastHeartbeat 不更新，此值须 > race 由 race 先兜底） */
const L3_DEAD_MS = 360_000;

// ── 类型 ────────────────────────────────────────────────────

export enum AgentExecutionState {
  Idle = "idle",
  Dispatched = "dispatched",
  Executing = "executing",
  TimedOut = "timed_out",
  Failed = "failed",
}

export interface AgentStateEntry {
  agentId: string;
  state: AgentExecutionState;
  nodeId: string;
  dispatchedAt: number;
  lastHeartbeat: number;
  pingSent: boolean;
  warned: boolean;
}

export interface TimeoutAction {
  type: 'warn' | 'ping' | 'kill';
  agentId: string;
  nodeId: string;
  elapsed: number;
}

// ── 主类 ────────────────────────────────────────────────────

export class AgentTracker {
  private states = new Map<string, AgentStateEntry>();

  /**
   * 标记 agent 已分发——开始超时计时。
   * @param agentId 跟踪标识（可重复使用——新 dispatch 覆盖旧状态）
   * @param nodeId  关联的节点 ID
   */
  markDispatched(agentId: string, nodeId: string): void {
    this.states.set(agentId, {
      agentId,
      state: AgentExecutionState.Dispatched,
      nodeId,
      dispatchedAt: Date.now(),
      lastHeartbeat: Date.now(),
      pingSent: false,
      warned: false,
    });
  }

  /**
   * 记录心跳——agent 仍在执行。
   * 重置计时基线（lastHeartbeat），但不改变 dispatchedAt。
   */
  recordHeartbeat(agentId: string): void {
    const s = this.states.get(agentId);
    if (s) {
      s.lastHeartbeat = Date.now();
      s.state = AgentExecutionState.Executing;
    }
  }

  /** 标记 agent 已完成——从跟踪中移除。 */
  markCompleted(agentId: string): void {
    this.states.delete(agentId);
  }

  /** 标记 agent 已失败——不再触发超时。 */
  markFailed(agentId: string): void {
    const s = this.states.get(agentId);
    if (s) s.state = AgentExecutionState.Failed;
  }

  /**
   * 检查所有正在跟踪的 agent，产出超时动作。
   *
   * 分层检测：
   *   elapsed > L3_DEAD_MS && pingSent → kill（标记 TimedOut）
   *   elapsed > L2_PING_MS && !pingSent → ping
   *   elapsed > L1_WARN_MS && !warned  → warn
   *
   * @param now 当前时间戳（Date.now()），调用方传入以保持一致性
   * @returns TimeoutAction[] 供调用方分发处理
   */
  checkTimeouts(now: number): TimeoutAction[] {
    const actions: TimeoutAction[] = [];
    for (const [, s] of this.states) {
      if (s.state === AgentExecutionState.Failed || s.state === AgentExecutionState.TimedOut) continue;
      // R12-B2：超时基线用 lastHeartbeat（心跳续命生效）——此前用 dispatchedAt，心跳不续命，慢任务必被误杀
      const elapsed = now - s.lastHeartbeat;

      if (elapsed > L3_DEAD_MS && s.pingSent) {
        s.state = AgentExecutionState.TimedOut;
        actions.push({ type: 'kill', agentId: s.agentId, nodeId: s.nodeId, elapsed });
      } else if (elapsed > L2_PING_MS && !s.pingSent) {
        s.pingSent = true;
        actions.push({ type: 'ping', agentId: s.agentId, nodeId: s.nodeId, elapsed });
      } else if (elapsed > L1_WARN_MS && !s.warned) {
        s.warned = true;
        actions.push({ type: 'warn', agentId: s.agentId, nodeId: s.nodeId, elapsed });
      }
    }
    return actions;
  }

  /** 当前正在跟踪的 agent 数。 */
  get size(): number {
    return this.states.size;
  }

  /** 清零所有状态（每次 executeAll() 结束时调用）。 */
  reset(): void {
    this.states.clear();
  }

  /**
   * 同步生命周期阶段到 Agent 状态机——ShutdownOrchestrator shutdown 时调用。
   *
   * lifecycle dispose → markFailed（释放后不可再调度）
   * lifecycle stop  → 保持当前状态（正在执行的任务继续完成）
   *
   * @param agentId 跟踪标识
   * @param lifecyclePhase 生命周期阶段：'stop' | 'dispose'
   */
  syncLifecycleState(agentId: string, lifecyclePhase: 'start' | 'stop' | 'dispose'): void {
    const state = this.states.get(agentId);
    if (!state) return;
    if (lifecyclePhase === 'dispose') {
      state.state = AgentExecutionState.Failed;
    }
    // 'stop'：保留当前状态，让正在执行的任务自然完成
  }
}
