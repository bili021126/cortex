/** 任务节点快照 */
export interface TaskNodeSnapshot {
  id: string
  nodeType: string
  agent: string
  description: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  parentId?: string
  durationMs?: number
}

/** Agent 状态快照 */
export interface AgentStatusSnapshot {
  agentType: string
  instanceId: string
  status: 'running' | 'idle' | 'error'
  lastHeartbeat: number
  /** 当前执行任务描述（用于展开卡片显示） */
  currentTask?: string
  /** Agent 启动时间戳（用于计算运行时长） */
  startedAt?: number
}

/** 审计报告摘要 */
export interface AuditReport {
  title: string
  date: string
  conclusion: string
}

/** 宪法版本记录 */
export interface ConstitutionVersion {
  version: string
  date: string
}

/** 合规违规项 */
export interface ComplianceViolation {
  rule: string
  severity: 'low' | 'medium' | 'high'
  description: string
}

/** 治理审视快照 */
export interface GovernanceSnapshot {
  auditReports: AuditReport[]
  constitutionVersions: ConstitutionVersion[]
  complianceViolations: ComplianceViolation[]
  docCodeGap: boolean
  roundTableConsensus: string
}

/** Agent 级别 token 用量分解 */
export interface TokenAgentBreakdown {
  agentName: string
  promptTokens: number
  completionTokens: number
  cost: number
  cacheHit: number
}

/** Token 用量汇总 */
export interface TokenUsageSummary {
  totalTokens: number
  totalCost: number
  cacheHitRate: number
  byAgent: TokenAgentBreakdown[]
}

/** 管线事件 */
export interface PipelineEvent {
  type: string
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL'
  payload: Record<string, unknown>
  timestamp: number
  /** 通知语义类型——FYI / WARNING / DECISION_REQUIRED */
  notificationType?: 'FYI' | 'WARNING' | 'DECISION_REQUIRED'
  /** 事件去重 ID（服务端下发时可选注入） */
  eventId?: string
  /** 请求追踪 ID（服务端下发时可选注入） */
  requestId?: string
}

/** 确认门事件（permission_required 类型） */
export interface PermissionRequest {
  toolName: string
  inputParams: Record<string, unknown>
  reversibilityLevel: 1 | 2 | 3
  requestId: string
  /** 触发来源：governance / skill-tool / interact */
  triggerSource?: 'governance' | 'skill-tool' | 'interact'
}

/** WebUI 全量状态 */
export interface WebUIState {
  timestamp: number
  nodes: TaskNodeSnapshot[]
  agents: AgentStatusSnapshot[]
  stats: {
    totalEvents: number
    deadLetters: number
    uptimeMs: number
  }
  health: 'healthy' | 'degraded' | 'unhealthy'
  /** 治理审视数据（后端 StateAggregator 推送） */
  governance?: GovernanceSnapshot
  /** Token 用量汇总 */
  tokenUsage?: TokenUsageSummary
}

/** WebSocket 收到的消息 */
export type WsMessage =
  | { channel: 'state'; data: WebUIState }
  | { channel: 'pipeline'; data: PipelineEvent }
  | { channel: 'tui'; data: Record<string, unknown> }
