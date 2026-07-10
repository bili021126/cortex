import React, { useRef, useEffect, useState } from 'react'
import type { PipelineEvent } from '../../types'

interface EventPipelineProps {
  events: PipelineEvent[]
}

const priorityColor: Record<string, string> = {
  '0': '#e07080',
  '1': '#e0b870',
  '2': '#9b8ec4',
  CRITICAL: '#e07080',
  HIGH: '#e0b870',
  NORMAL: '#9b8ec4',
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '12px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  title: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#ede8f5',
    margin: 0,
  },
  pauseBtn: {
    background: 'none',
    border: '1px solid #3d3560',
    color: '#a89cc8',
    cursor: 'pointer',
    fontSize: '12px',
    padding: '4px 10px',
    borderRadius: '6px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    borderRadius: '6px',
    fontSize: '13px',
    fontFamily: "'JetBrains Mono', monospace",
    backgroundColor: '#262640',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#1e1e36',
    minWidth: '60px',
    textAlign: 'center' as const,
  },
  timestamp: {
    color: '#a89cc8',
    fontSize: '11px',
    whiteSpace: 'nowrap' as const,
  },
  summary: {
    color: '#ede8f5',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: 1,
  },
  triggerSource: {
    fontSize: '10px',
    color: '#7a6e98',
    marginLeft: '4px',
    whiteSpace: 'nowrap' as const,
  },
  empty: {
    color: '#a89cc8',
    fontSize: '13px',
    textAlign: 'center' as const,
    padding: '32px',
  },
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

function makeSummary(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload)
  if (keys.length === 0) return '(empty)'
  return keys.map((k) => `${k}: ${String(payload[k]).slice(0, 40)}`).join(', ')
}

function getTriggerSource(payload: Record<string, unknown>): string | null {
  const src = payload?.triggerSource
  if (typeof src === 'string' && src) return src
  return null
}

export function EventPipeline({ events }: EventPipelineProps) {
  const [paused, setPaused] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const prevLengthRef = useRef(events.length)
  const [pulsingIdx, setPulsingIdx] = useState<number | null>(null)

  // 自动滚动到最新，除非暂停
  useEffect(() => {
    if (paused) return
    if (events.length > prevLengthRef.current) {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight
      }
      // 新事件脉冲
      const displayLen = Math.min(events.length, 50)
      setPulsingIdx(displayLen - 1)
      const timer = setTimeout(() => setPulsingIdx(null), 300)
      prevLengthRef.current = events.length
      return () => clearTimeout(timer)
    }
    prevLengthRef.current = events.length
  }, [events.length, paused])

  const displayEvents = events.slice(-50)

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>📡 事件管线</h3>
        <button
          style={styles.pauseBtn}
          onClick={() => setPaused(!paused)}
        >
          {paused ? '▶ 继续' : '⏸ 暂停'}
        </button>
      </div>
      <div
        ref={listRef}
        style={{
          ...styles.list,
          maxHeight: '360px',
          overflowY: 'auto',
        }}
      >
        {displayEvents.length === 0 && (
          <div style={styles.empty}>等待事件流入...</div>
        )}
        {displayEvents.map((evt, i) => (
          <div key={`${evt.timestamp}-${i}`} style={styles.row} className={i === pulsingIdx ? 'event-row pulse' : 'event-row'}>
            <span
              style={{
                ...styles.badge,
                backgroundColor: priorityColor[String(evt.priority)] || '#9b8ec4',
              }}
            >
              {evt.priority}
            </span>
            <span style={styles.timestamp}>{formatTime(evt.timestamp)}</span>
            <span style={styles.summary}>
              <strong>{evt.type}</strong> — {makeSummary(evt.payload)}
              {getTriggerSource(evt.payload) && (
                <span style={styles.triggerSource}>
                  [{getTriggerSource(evt.payload)}]
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
