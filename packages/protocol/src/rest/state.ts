/**
 * @cortex/protocol — GET /state 响应类型
 *
 * 全局状态快照——TaskBoard + AgentPool + Pipeline + Health 的聚合视图。
 */

/** 任务节点快照 */
export interface TaskNodeSnapshot {
  id: string;
  nodeType: string;
  agent: string;
  description: string;
  status: "pending" | "running" | "complete" | "failed";
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

/** 管线统计快照 */
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

/** 健康状态快照 */
export interface HealthSnapshot {
  timestamp: number;
  totalDegradations: number;
  bySource: Record<string, number>;
  byLevel: Record<string, number>;
  recentSources: string[];
  degradedSince: number | null;
}

/** 运行时统计 */
export interface RuntimeStats {
  totalEvents: number;
  deadLetters: number;
  uptimeMs: number;
}

/** 完整 WebUI 状态 */
export interface WebUIState {
  timestamp: number;
  nodes: TaskNodeSnapshot[];
  agents: AgentStatusSnapshot[];
  pipeline: PipelineSnapshot;
  health: HealthSnapshot;
  stats: RuntimeStats;
}
