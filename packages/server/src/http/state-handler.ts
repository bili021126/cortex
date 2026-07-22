/**
 * @cortex/server — StateAggregator
 *
 * Aggregates TaskBoard + AgentPool + HealthCollector into a WebUIState snapshot.
 * Supports subscription with 500ms heartbeat and incremental pipeline event updates.
 */

import type { ITaskBoard, IAgentPool, ObservableEvent } from "@cortex/shared";
import type { HealthCollector } from "@cortex/telemetry";
import type {
  WebUIState,
  TaskNodeSnapshot,
  AgentStatusSnapshot,
  PipelineSnapshot,
  HealthSnapshot,
  RuntimeStats,
} from "@cortex/protocol";

type StateCallback = (state: WebUIState) => void;

const HEARTBEAT_INTERVAL_MS = 500;

export class StateAggregator {
  private readonly board: ITaskBoard;
  private readonly pool: IAgentPool;
  private readonly healthCollector: HealthCollector | undefined;
  private subscribers = new Set<StateCallback>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = Date.now();

  // Incremental counters
  private eventCounts = {
    node: 0,
    governance: 0,
    memory: 0,
    error: 0,
    tool: 0,
    scheduler: 0,
  };
  private totalEvents = 0;
  private deadLetters = 0;

  constructor(board: ITaskBoard, pool: IAgentPool, healthCollector?: HealthCollector) {
    this.board = board;
    this.pool = pool;
    this.healthCollector = healthCollector;
  }

  /**
   * Subscribe to state updates. Starts heartbeat if first subscriber.
   */
  subscribe(callback: StateCallback): () => void {
    this.subscribers.add(callback);
    if (this.subscribers.size === 1) {
      this.startHeartbeat();
    }
    return () => {
      this.subscribers.delete(callback);
      if (this.subscribers.size === 0) {
        this.stopHeartbeat();
      }
    };
  }

  /**
   * Handle incremental pipeline events for counter updates.
   */
  onPipelineEvent(event: ObservableEvent): void {
    this.totalEvents++;
    const type = String(event.type ?? "");

    if (type.startsWith("node.")) this.eventCounts.node++;
    else if (type.startsWith("governance.") || type.startsWith("constitution.")) this.eventCounts.governance++;
    else if (type.startsWith("memory.") || type.startsWith("mem.")) this.eventCounts.memory++;
    else if (type.startsWith("error.")) this.eventCounts.error++;
    else if (type.startsWith("skill.") || type.startsWith("tool.")) this.eventCounts.tool++;
    else if (type.startsWith("scheduler.")) this.eventCounts.scheduler++;
  }

  /**
   * Get current state snapshot.
   */
  getSnapshot(): WebUIState {
    return {
      timestamp: Date.now(),
      nodes: this.getNodeSnapshots(),
      agents: this.getAgentSnapshots(),
      pipeline: this.getPipelineSnapshot(),
      health: this.getHealthSnapshot(),
      stats: this.getRuntimeStats(),
    };
  }

  /**
   * Dispose: stop heartbeat and clear subscribers.
   */
  dispose(): void {
    this.stopHeartbeat();
    this.subscribers.clear();
  }

  // ── Private ──────────────────────────────────────────

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const state = this.getSnapshot();
      for (const cb of this.subscribers) {
        try {
          cb(state);
        } catch {
          // subscriber error is non-fatal
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    if (this.heartbeatTimer && typeof this.heartbeatTimer === "object" && "unref" in this.heartbeatTimer) {
      this.heartbeatTimer.unref();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private getNodeSnapshots(): TaskNodeSnapshot[] {
    try {
      const nodes = this.board.getAllNodes();
      return nodes.map((n) => ({
        id: n.id,
        nodeType: n.type ?? "unknown",
        agent: n.claimedBy?.[0] ?? "",
        description: n.payload ?? "",
        status: (n.status === "done" ? "complete" : n.status === "claimed" ? "pending" : n.status) as TaskNodeSnapshot["status"],
        parentId: n.parentId,
      }));
    } catch {
      return [];
    }
  }

  private getAgentSnapshots(): AgentStatusSnapshot[] {
    try {
      const stats = this.pool.getPoolStats();
      // Return pool-level stats as a single entry
      return [{
        agentType: "pool",
        instanceId: "main",
        status: `total=${stats.total} idle=${stats.idle} busy=${stats.busy}`,
        lastHeartbeat: Date.now(),
      }];
    } catch {
      return [];
    }
  }

  private getPipelineSnapshot(): PipelineSnapshot {
    try {
      const nodes = this.board.getAllNodes();
      let running = 0;
      let failed = 0;
      let completed = 0;
      let pending = 0;

      for (const n of nodes) {
        switch (n.status) {
          case "running": running++; break;
          case "failed": failed++; break;
          case "done": completed++; break;
          default: pending++; break;
        }
      }

      return {
        nodeCount: nodes.length,
        runningCount: running,
        failedCount: failed,
        completedCount: completed,
        pendingCount: pending,
        totalDurationMs: 0,
        eventCounts: { ...this.eventCounts },
      };
    } catch {
      return {
        nodeCount: 0,
        runningCount: 0,
        failedCount: 0,
        completedCount: 0,
        pendingCount: 0,
        totalDurationMs: 0,
        eventCounts: { ...this.eventCounts },
      };
    }
  }

  private getHealthSnapshot(): HealthSnapshot {
    return {
      timestamp: Date.now(),
      totalDegradations: 0,
      bySource: {},
      byLevel: {},
      recentSources: [],
      degradedSince: null,
    };
  }

  private getRuntimeStats(): RuntimeStats {
    return {
      totalEvents: this.totalEvents,
      deadLetters: this.deadLetters,
      uptimeMs: Date.now() - this.startedAt,
    };
  }
}
