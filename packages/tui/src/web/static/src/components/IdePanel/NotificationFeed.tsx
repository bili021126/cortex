import React from 'react'
import type { PipelineEvent } from '../../types'

interface NotificationFeedProps {
  events: PipelineEvent[]
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
    fontFamily: "'Cormorant Garamond', serif",
  },
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: '6px',
    fontSize: '13px',
    backgroundColor: '#262640',
    border: '1px solid #2e2e45',
  },
  dotColumn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: '4px',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
  },
  line: {
    width: '1px',
    flex: 1,
    backgroundColor: '#363658',
    minHeight: '20px',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  typeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '4px',
  },
  typeBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#1e1e36',
    padding: '1px 6px',
    borderRadius: '4px',
    display: 'inline-block',
  },
  fyiBadge: {
    backgroundColor: '#9b8ec4',
  },
  warningBadge: {
    backgroundColor: '#e0b870',
  },
  message: {
    color: '#ede8f5',
  },
  timestamp: {
    fontSize: '11px',
    color: '#9b8ec4',
    marginTop: '4px',
  },
  empty: {
    color: '#9b8ec4',
    fontSize: '13px',
    textAlign: 'center' as const,
    padding: '32px',
  },
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

function getNotificationLevel(event: PipelineEvent): 'FYI' | 'WARNING' {
  const nt = event.notificationType
  if (nt === 'WARNING') return 'WARNING'
  return 'FYI'
}

function getNotificationMessage(event: PipelineEvent): string {
  // 优先从 payload 中取可读信息，fallback 到事件 type
  return String(event.payload?.message || event.payload?.text || event.type)
}

export function NotificationFeed({ events }: NotificationFeedProps) {
  // 筛选有 notificationType 的事件（顶层字段），按时间倒序
  const notifications = events
    .filter((e) => e.notificationType)
    .sort((a, b) => b.timestamp - a.timestamp)

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>🔔 通知</h3>
      {notifications.length === 0 && (
        <div style={styles.empty}>暂无通知</div>
      )}
      <div style={styles.timeline}>
        {notifications.map((evt, i) => {
          const level = getNotificationLevel(evt)
          const message = getNotificationMessage(evt)
          const dotColor = level === 'WARNING' ? '#e0b870' : '#a89cc8'
          const badgeStyle =
            level === 'WARNING' ? styles.warningBadge : styles.fyiBadge

          return (
            <div key={`notif-${evt.timestamp}-${i}`} style={styles.item}>
              <div style={styles.dotColumn}>
                <span style={{ ...styles.dot, backgroundColor: dotColor }} />
                {i < notifications.length - 1 && <div style={styles.line} />}
              </div>
              <div style={styles.content}>
                <div style={styles.typeRow}>
                  <span style={{ ...styles.typeBadge, ...badgeStyle }}>
                    {level}
                  </span>
                </div>
                <div style={styles.message}>{message}</div>
                <div style={styles.timestamp}>{formatTime(evt.timestamp)}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
