import React from 'react'
import { useState } from 'react'
import type { AgentStatusSnapshot, PipelineEvent } from '../../types'

interface AgentForestProps {
  agents: AgentStatusSnapshot[]
  /** 从 pipeline 事件中筛选的 agent 日志 */
  agentLogs?: Record<string, PipelineEvent[]>
}

const statusColor: Record<string, string> = {
  running: '#7ecb9a',
  idle: '#7a6e98',
  error: '#e07080',
}

const statusLabel: Record<string, string> = {
  running: '运行中',
  idle: '空闲',
  error: '异常',
}

const agentIcon: Record<string, string> = {
  advisor: '🧠',
  orchestrator: '🎯',
  writer: '✍️',
  reviewer: '🔍',
  coder: '💻',
  archivist: '📚',
  sentinel: '🛡️',
  executor: '⚡',
}

function getIcon(agentType: string): string {
  const lower = agentType.toLowerCase()
  for (const [key, icon] of Object.entries(agentIcon)) {
    if (lower.includes(key)) return icon
  }
  return '🤖'
}

function formatRuntime(startedAt?: number): string {
  if (!startedAt) return 'N/A'
  const diff = Date.now() - startedAt
  const totalSeconds = Math.floor(diff / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '12px',
  },
  title: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#ede8f5',
    margin: '0 0 12px 0',
  },
  wrap: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '10px',
  },
  cardCollapsed: {
    width: '120px',
    backgroundColor: '#262640',
    border: '1px solid #363658',
    borderRadius: '8px',
    padding: '10px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    position: 'relative' as const,
    overflow: 'hidden',
    transition: 'width 0.2s ease, box-shadow 0.2s ease',
  },
  cardExpanded: {
    width: '320px',
    backgroundColor: '#262640',
    border: '1px solid #363658',
    borderRadius: '8px',
    padding: '14px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    position: 'relative' as const,
    transition: 'width 0.2s ease, box-shadow 0.2s ease',
  },
  statusBar: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    width: '3px',
    height: '100%',
    borderRadius: '0 8px 8px 0',
  },
  iconRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  agentName: {
    fontSize: '16px',
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    color: '#ede8f5',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  taskLine: {
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace",
    color: '#a89cc8',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  detailLabel: {
    fontSize: '11px',
    color: '#7a6e98',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '2px',
  },
  detailValue: {
    fontSize: '13px',
    color: '#ede8f5',
  },
  tag: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    backgroundColor: '#363658',
    color: '#a89cc8',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  logItem: {
    fontSize: '11px',
    fontFamily: "'JetBrains Mono', monospace",
    color: '#a89cc8',
    padding: '3px 6px',
    backgroundColor: '#1e1e36',
    borderRadius: '4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  traceBtn: {
    padding: '6px 12px',
    border: '1px solid #3d3560',
    borderRadius: '6px',
    backgroundColor: 'transparent',
    color: '#5a4e78',
    fontSize: '12px',
    cursor: 'not-allowed',
    opacity: 0.5,
    alignSelf: 'flex-start',
  },
  empty: {
    color: '#a89cc8',
    fontSize: '16px',
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    textAlign: 'center' as const,
    padding: '40px',
  },
}

function getRecentLogs(
  agentType: string,
  logs?: Record<string, PipelineEvent[]>,
): PipelineEvent[] {
  if (!logs) return []
  return (logs[agentType] || []).slice(-3)
}

function makeLogSummary(evt: PipelineEvent): string {
  const msg =
    String(evt.payload?.message || evt.payload?.text || evt.payload?.summary || '')
  return msg.slice(0, 50) || evt.type
}

export function AgentForest({ agents, agentLogs }: AgentForestProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpand = (instanceId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(instanceId)) {
        next.delete(instanceId)
      } else {
        next.add(instanceId)
      }
      return next
    })
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>🌲 Agent 森林</h3>
      {agents.length === 0 && (
        <div style={styles.empty}>等待引擎调度...</div>
      )}
      <div style={styles.wrap}>
        {agents.map((agent) => {
          const isExpanded = expanded.has(agent.instanceId)
          const color = statusColor[agent.status] || '#7a6e98'
          const logs = getRecentLogs(agent.agentType, agentLogs)

          return (
            <div
              key={agent.instanceId}
              style={isExpanded ? styles.cardExpanded : styles.cardCollapsed}
              onClick={() => toggleExpand(agent.instanceId)}
            >
              {/* 右侧状态色条 */}
              <div style={{ ...styles.statusBar, backgroundColor: color }} />

              {!isExpanded ? (
                /* 缩略态 */
                <>
                  <div style={styles.iconRow}>
                    <span style={{ fontSize: '18px' }}>{getIcon(agent.agentType)}</span>
                    <span style={styles.agentName}>{agent.agentType}</span>
                  </div>
                  <div style={styles.taskLine}>
                    {agent.currentTask || '等待分配'}
                  </div>
                </>
              ) : (
                /* 展开态 */
                <>
                  <div style={{ ...styles.iconRow, marginBottom: '4px' }}>
                    <span style={{ fontSize: '22px' }}>{getIcon(agent.agentType)}</span>
                    <span style={{ ...styles.agentName, fontSize: '18px' }}>
                      {agent.agentType}
                    </span>
                  </div>

                  {/* 运行时长 */}
                  <div>
                    <div style={styles.detailLabel}>运行时长</div>
                    <div style={styles.detailValue}>
                      {formatRuntime(agent.startedAt)}
                    </div>
                  </div>

                  {/* 类型标签 */}
                  <div>
                    <div style={styles.detailLabel}>类型</div>
                    <span style={styles.tag}>{agent.agentType}</span>
                  </div>

                  {/* 状态 */}
                  <div>
                    <div style={styles.detailLabel}>状态</div>
                    <div style={styles.statusRow}>
                      <span style={{ ...styles.dot, backgroundColor: color }} />
                      <span style={{ ...styles.detailValue, color }}>
                        {statusLabel[agent.status] || agent.status}
                      </span>
                    </div>
                  </div>

                  {/* 最近日志 */}
                  <div>
                    <div style={styles.detailLabel}>最近日志</div>
                    {logs.length === 0 && (
                      <div style={{ fontSize: '11px', color: '#7a6e98', fontStyle: 'italic' }}>
                        暂无日志
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {logs.map((log, idx) => (
                        <div key={idx} style={styles.logItem}>
                          {makeLogSummary(log)}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 查看 Trace 按钮 */}
                  <button
                    style={styles.traceBtn}
                    disabled
                    title="功能开发中"
                  >
                    🔍 查看 Trace
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
