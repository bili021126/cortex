/**
 * tui/web/state-aggregator.ts — 状态聚合层
 *
 * 把 PipelineObserver / TaskBoard / AgentPool 三个源聚合为统一 WebUIState。
 * 同时为 WSGateway 提供定时推送和事件驱动推送。
 *
 * @module tui/web/state-aggregator
 */

import type { IPipelineObserver, ObservableEvent, ITaskBoard, IAgentPool } from "@cortex/shared";
import { AgentType, AgentStatus, PipelinePriority, PipelineEventType } from "@cortex/shared";
import type { PanoramaTracker } from "@cortex/telemetry";
import type { HealthCollector, HealthSnapshot } from "@cortex/telemetry";

// ─── WebUI 公开类型 ──────────────────────────────

/** 任务节点快照（WebUI 友好版 — 匹配前端 types.ts） */
export interface TaskNodeSnapshot {
  id: string;
  nodeType: string;
  agent: string;
  description: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  parentId?: string;
  durationMs?: number;
}

/** Agent 状态快照 */
export interface AgentStatusSnapshot {
  agentType: string;
  instanceId: string;
  status: string;
  lastHeartbeat: number;
}

/** Pipeline 快照 */
export interface PipelineSnapshot {
  nodeCount: number;
  runningCount: number;
  failedCount: number;
  completedCount: number;
  pendingCount: number;
  totalDurationMs: number;
  eventCounts: {
    node: number;
    governance: number;
    memory: number;
    error: number;
    tool: number;
    scheduler: number;
  };
}

/** 聚合后的完整 WebUI 状态 */
export interface WebUIState {
  timestamp: number;
  nodes: TaskNodeSnapshot[];
  agents: AgentStatusSnapshot[];
  pipeline: PipelineSnapshot;
  health: HealthSnapshot;
  stats: {
    totalEvents: number;
    deadLetters: number;
    uptimeMs: number;
  };
}

// ─── 状态映射辅助 ──────────────────────────────

/** 将 TaskNode.status 映射为前端 TaskNodeSnapshot.status */
function mapNodeStatus(status: string): TaskNodeSnapshot['status'] {
  switch (status) {
    case 'done': return 'complete';
    case 'claimed': return 'pending';
    case 'running': return 'running';
    case 'failed': return 'failed';
    case 'pending': return 'pending';
    default: return 'pending';
  }
}

// ─── StateAggregator ─────────────────────────────

type StateCallback = (state: WebUIState) => void;

export class StateAggregator {
  private readonly taskBoard: ITaskBoard | null;
  private readonly agentPool: IAgentPool | null;
  private readonly healthCollector: HealthCollector | null;
  private readonly startTime: number;
  private subscribers = new Set<StateCallback>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  /** 内部事件计数器 */
  private totalEvents = 0;
  private deadLetters = 0;

  /** 节点统计（自行追踪而非依赖 PanoramaTracker 内部状态） */
  private nodeRunningCount = 0;
  private nodeFailedCount = 0;
  private nodeCompletedCount = 0;
  private nodePendingCount = 0;
  private nodeEventCounts = {
    node: 0,
    governance: 0,
    memory: 0,
    error: 0,
    tool: 0,
    scheduler: 0,
  };

  constructor(
    taskBoard: ITaskBoard | null,
    agentPool: IAgentPool | null,
    _panoramaTracker: PanoramaTracker | null,
    healthCollector: HealthCollector | null,
  ) {
    this.taskBoard = taskBoard;
    this.agentPool = agentPool;
    this.healthCollector = healthCollector;
    this.startTime = Date.now();
  }

  /**
   * 生成当前完整快照。
   */
  getSnapshot(): WebUIState {
    const now = Date.now();

    // 从 TaskBoard 获取节点
    const allNodes = this.taskBoard ? this.taskBoard.getAllNodes() : [];
    const nodeSnapshots: TaskNodeSnapshot[] = allNodes.map((node) => ({
      id: node.id,
      nodeType: node.type,
      agent: node.claimedBy?.[0] ?? '',
      description: String(node.payload ?? '').slice(0, 200),
      status: mapNodeStatus(node.status),
      parentId: node.parentId,
      durationMs: undefined,
    }));

    // 从 AgentPool 获取状态（遍历所有 AgentType 枚举值）
    const agentSnapshots: AgentStatusSnapshot[] = [];
    const agentTypes = Object.values(AgentType).filter(
      (v): v is AgentType => typeof v === "string",
    ) as AgentType[];
    for (const agentType of agentTypes) {
      const statuses = this.agentPool ? this.agentPool.getStatuses(agentType) : [];
      if (statuses.length === 0) continue;
      // 映射后端状态枚举 → 前端友好状态
      for (let i = 0; i < statuses.length; i++) {
        const s = statuses[i]!;
        let frontendStatus: string;
        switch (s) {
          case AgentStatus.Active:
            frontendStatus = "running";
            break;
          default:
            frontendStatus = "idle";
            break;
        }
        agentSnapshots.push({
          agentType,
          instanceId: `${agentType}-${i}`,
          status: frontendStatus,
          lastHeartbeat: Date.now(),
        });
      }
    }

    // 使用内部追踪的节点统计
    const allNodesList = this.taskBoard ? this.taskBoard.getAllNodes() : [];
    let runningCount = 0;
    let failedCount = 0;
    let completedCount = 0;
    let pendingCount = 0;
    for (const n of allNodesList) {
      switch (n.status) {
        case "running": runningCount++; break;
        case "failed": failedCount++; break;
        case "done": completedCount++; break;
        case "pending": case "claimed": pendingCount++; break;
        default: pendingCount++;
      }
    }

    const pipeline: PipelineSnapshot = {
      nodeCount: allNodesList.length,
      runningCount,
      failedCount,
      completedCount,
      pendingCount,
      totalDurationMs: now - this.startTime,
      eventCounts: { ...this.nodeEventCounts },
    };

    // 健康快照
    const health = this.healthCollector
      ? this.healthCollector.snapshot()
      : { timestamp: Date.now(), totalDegradations: 0, bySource: {}, byLevel: {}, recentSources: [], degradedSince: null };

    const state: WebUIState = {
      timestamp: now,
      nodes: nodeSnapshots,
      agents: agentSnapshots,
      pipeline,
      health,
      stats: {
        totalEvents: this.totalEvents,
        deadLetters: this.deadLetters,
        uptimeMs: now - this.startTime,
      },
    };

    return state;
  }

  /**
   * 监听 PipelineObserver 事件，增量更新内部状态。
   */
  onPipelineEvent(event: ObservableEvent): void {
    this.totalEvents++;

    // 更新事件计数分类
    const t = event.type;
    if (t.includes("node.")) this.nodeEventCounts.node++;
    else if (t.includes("governance") || t.includes("constitution") || t.includes("compliance")) this.nodeEventCounts.governance++;
    else if (t.includes("memory.")) this.nodeEventCounts.memory++;
    else if (t.includes("error.") || t.includes("failed")) this.nodeEventCounts.error++;
    else if (t.includes("tool.")) this.nodeEventCounts.tool++;
    else if (t.includes("scheduler") || t.includes("agent_pool.")) this.nodeEventCounts.scheduler++;

    // 死信统计
    if (
      event.type === PipelineEventType.ErrorSilentUpgraded ||
      event.type === PipelineEventType.ErrorReported
    ) {
      this.deadLetters++;
    }

    // 通知订阅者
    if (this.subscribers.size > 0) {
      const state = this.getSnapshot();
      for (const cb of this.subscribers) {
        try {
          cb(state);
        } catch {
          // 静默——不因单个订阅者异常影响其他订阅者
        }
      }
    }
  }

  /**
   * 订阅状态更新（事件驱动 + 定时心跳）。
   * 返回取消订阅函数。
   */
  subscribe(callback: StateCallback): () => void {
    this.subscribers.add(callback);

    // 第一个订阅者时启动定时心跳（每 500ms）
    if (this.subscribers.size === 1 && this.tickTimer === null) {
      this.tickTimer = setInterval(() => {
        if (this.subscribers.size === 0) return;
        const state = this.getSnapshot();
        for (const cb of this.subscribers) {
          try {
            cb(state);
          } catch {
            // 静默
          }
        }
      }, 500);
    }

    return () => {
      this.subscribers.delete(callback);
      if (this.subscribers.size === 0 && this.tickTimer !== null) {
        clearInterval(this.tickTimer);
        this.tickTimer = null;
      }
    };
  }

  /**
   * 更新 Agent 快照列表（由外部传入，因 AgentType 枚举变化频繁）。
   */
  updateAgentSnapshots(snapshots: AgentStatusSnapshot[]): void {
    // 在每次 getSnapshot 中动态构造
    // 这个方法留给外部注入 AgentType 枚举值
  }

  /** 析构清理 */
  dispose(): void {
    this.subscribers.clear();
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }
}
