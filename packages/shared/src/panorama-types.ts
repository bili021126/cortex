// ============================================================
// @cortex/shared — PanoramaTracker 完整类型定义
//
// 从 packages/engine/tests/manual/e2e/panorama-tracker.ts 提取，
// 生产化后作为 @cortex/shared 公开类型供 telemetry/engine 等包共用。
// ============================================================

/** 工具调用记录 */
export interface ToolCallRecord {
  toolName: string;
  params: Record<string, unknown>;
  agentType: string;
  nodeId: string;
  startTime: number;
  endTime: number;
  success: boolean;
  durationMs: number;
}

/** 节点追踪记录 */
export interface NodeTrace {
  nodeId: string;
  agentType: string;
  nodeType: string;
  status: "pending" | "claimed" | "running" | "done" | "failed";
  claimedAt: number;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  success: boolean;
  output: string;
  error: string;
  toolCalls: ToolCallRecord[];
  replanCount: number;
}

/** 记忆事件记录 */
export interface MemoryEventRecord {
  layer: "L1" | "L2" | "L3" | "L4" | "L5" | "L6";
  event: string;
  passed: boolean;
  detail: string;
  timestamp: number;
}

/** 文件写入记录 */
export interface FileWriteRecord {
  filePath: string;
  agentType: string;
  claimedSize: number;
  verified: boolean;
  verifiedSize: number;
  success: boolean;
}

/** 阶段记录 */
export interface PhaseRecord {
  phase: string;
  label: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  detail: string;
}

/** 技能记录 */
export interface SkillRecord {
  skillId: string;
  agentType: string;
  action: "referenced" | "produced";
  detail: string;
}

/** 事件计数 */
export interface EventCounts {
  node: number;
  governance: number;
  memory: number;
  skill: number;
  tool: number;
  scheduler: number;
  error: number;
  manifold: number;
  rlm: number;
  context: number;
}

/** 全景快照——一次实验/执行周期的完整执行报告 */
export interface PanoramaSnapshot {
  experiment: string;
  startTime: number;
  endTime: number;
  totalDurationMs: number;
  phases: PhaseRecord[];
  nodes: Record<string, NodeTrace>;
  events: EventCounts;
  memory: MemoryEventRecord[];
  files: FileWriteRecord[];
  skills: SkillRecord[];
  verdict: {
    passed: boolean;
    nodePassRate: string;
    compilePass: boolean | null;
    testPass: boolean | null;
    fileVerifyPass: number;
    fileVerifyTotal: number;
  };
  timelinePath: string;
  eventsPath: string;
  summaryPath: string;
}
