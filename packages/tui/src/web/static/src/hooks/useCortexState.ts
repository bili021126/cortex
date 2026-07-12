import { useState, useCallback, useRef } from 'react'
import { useWebSocket } from './useWebSocket'
import type {
  WebUIState,
  PipelineEvent,
  WsMessage,
  GovernanceSnapshot,
  TokenUsageSummary,
  TokenAgentBreakdown,
} from '../types'

const INITIAL_STATE: WebUIState = {
  timestamp: 0,
  nodes: [],
  agents: [],
  stats: { totalEvents: 0, deadLetters: 0, uptimeMs: 0 },
  health: 'healthy',
}

export function useCortexState() {
  const [state, setState] = useState<WebUIState>(INITIAL_STATE)
  const [connected, setConnected] = useState(false)
  const [hasReceivedData, setHasReceivedData] = useState(false)
  const [pipelineEvents, setPipelineEvents] = useState<PipelineEvent[]>([])
  const [pendingPermission, setPendingPermission] = useState<PipelineEvent | null>(null)
  const [governance, setGovernance] = useState<GovernanceSnapshot | undefined>(undefined)
  const [tokenUsage, setTokenUsage] = useState<TokenUsageSummary | undefined>(undefined)
  const [agentLogs, setAgentLogs] = useState<Record<string, PipelineEvent[]>>({})
  const eventCountRef = useRef(0)
  const hasReceivedDataRef = useRef(false)
  const seenEventIds = useRef<Set<string>>(new Set())

  const handleMessage = useCallback((raw: unknown) => {
    const msg = raw as WsMessage
    if (!msg || !msg.channel) return

    // 首次收到数据时标记
    if (!hasReceivedDataRef.current) {
      hasReceivedDataRef.current = true
      setHasReceivedData(true)
    }

    // 开发调试日志——确认数据到达
    if (process.env.NODE_ENV === 'development') {
      console.log('[Cortex]', msg.channel, msg.data)
    }

    switch (msg.channel) {
      case 'state': {
        const data = msg.data as WebUIState
        if (data && data.timestamp) {
          setState(data)
          if (data.governance) {
            setGovernance(data.governance)
          }
          if (data.tokenUsage) {
            setTokenUsage(data.tokenUsage)
          }
        }
        break
      }
      case 'pipeline': {
        const evt = msg.data as PipelineEvent
        if (!evt || !evt.type) return

        // 事件去重：用 eventId / requestId / type+timestamp+payload hash 做键
        const dedupKey = String(
          evt.eventId ?? evt.requestId ??
          `${evt.type}-${evt.timestamp}-${JSON.stringify(evt.payload).slice(0, 100)}`
        )
        if (seenEventIds.current.has(dedupKey)) {
          return // 跳过重复
        }
        seenEventIds.current.add(dedupKey)
        if (seenEventIds.current.size > 1000) {
          seenEventIds.current = new Set([...seenEventIds.current].slice(-500))
        }

        eventCountRef.current++

        setPipelineEvents((prev) => {
          const next = [...prev, evt]
          return next.length > 200 ? next.slice(next.length - 200) : next
        })

        // 按 agent 分类日志
        const agentName = String(evt.payload?.agent || evt.payload?.agentType || '')
        if (agentName) {
          setAgentLogs((prev) => {
            const existing = prev[agentName] || []
            const next = [...existing, evt]
            return {
              ...prev,
              [agentName]: next.length > 50 ? next.slice(next.length - 50) : next,
            }
          })
        }

        // 从 governance 事件提取治理数据
        if (evt.type === 'governance_audit' || evt.type === 'governance_update') {
          const govPayload = evt.payload
          if (govPayload && typeof govPayload === 'object') {
            const p = govPayload as Record<string, unknown>
            const govData: GovernanceSnapshot = {
              auditReports: (p.auditReports as GovernanceSnapshot['auditReports']) || [],
              constitutionVersions: (p.constitutionVersions as GovernanceSnapshot['constitutionVersions']) || [],
              complianceViolations: (p.complianceViolations as GovernanceSnapshot['complianceViolations']) || [],
              docCodeGap: Boolean(p.docCodeGap),
              roundTableConsensus: String(p.roundTableConsensus || ''),
            }
            setGovernance(govData)
          }
        }

        // 从 token_usage 事件聚合 Token 用量
        if (evt.type === 'token_usage') {
          const usagePayload = evt.payload
          if (usagePayload && typeof usagePayload === 'object') {
            const p = usagePayload as Record<string, unknown>
            const agentName = String(p.agent || p.agentType || 'unknown')
            const promptTokens = Number(p.prompt_tokens || p.promptTokens || 0)
            const completionTokens = Number(p.completion_tokens || p.completionTokens || 0)
            const cost = Number(p.cost || 0)
            const cacheHit = Number(p.cache_hit || p.cacheHit || 0)

            setTokenUsage((prev) => {
              const existing = prev || { totalTokens: 0, totalCost: 0, cacheHitRate: 0, byAgent: [] }
              const agentIdx = existing.byAgent.findIndex((a) => a.agentName === agentName)
              const newByAgent: TokenAgentBreakdown[] = [...existing.byAgent]
              if (agentIdx >= 0) {
                const a = newByAgent[agentIdx]
                newByAgent[agentIdx] = {
                  ...a,
                  promptTokens: a.promptTokens + promptTokens,
                  completionTokens: a.completionTokens + completionTokens,
                  cost: a.cost + cost,
                  cacheHit: a.cacheHit + cacheHit,
                }
              } else {
                newByAgent.push({
                  agentName,
                  promptTokens,
                  completionTokens,
                  cost,
                  cacheHit,
                })
              }
              const newTotalTokens = newByAgent.reduce((s, a) => s + a.promptTokens + a.completionTokens, 0)
              const newTotalCost = newByAgent.reduce((s, a) => s + a.cost, 0)
              const totalCacheHits = newByAgent.reduce((s, a) => s + a.cacheHit, 0)
              const totalCalls = totalCacheHits + newByAgent.reduce((s, a) => s + a.promptTokens + a.completionTokens, 0)
              return {
                totalTokens: newTotalTokens,
                totalCost: newTotalCost,
                cacheHitRate: totalCalls > 0 ? totalCacheHits / totalCalls : 0,
                byAgent: newByAgent,
              }
            })
          }
        }

        // permission_required 事件触发确认门
        if (evt.type === 'permission_required') {
          setPendingPermission(evt)
        }
        break
      }
      case 'tui': {
        break
      }
    }
  }, [])

  useWebSocket({
    url: `ws://${location.host}/ws`,
    onMessage: handleMessage,
    onStatusChange: setConnected,
  })

  const clearPermission = useCallback(() => {
    setPendingPermission(null)
  }, [])

  return {
    state,
    connected,
    hasReceivedData,
    pipelineEvents,
    pendingPermission,
    clearPermission,
    eventCount: eventCountRef.current,
    governance,
    tokenUsage,
    agentLogs,
  }
}
