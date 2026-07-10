import React from 'react'
import type { WebUIState } from '../../types'

interface TelemetryDashboardProps {
  stats: WebUIState['stats']
  health: WebUIState['health']
}

const healthColor: Record<string, string> = {
  healthy: '#7ecb9a',
  degraded: '#e0b870',
  unhealthy: '#e07080',
}

const healthLabel: Record<string, string> = {
  healthy: '健康',
  degraded: '降级',
  unhealthy: '不健康',
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
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '10px',
    marginBottom: '12px',
  },
  card: {
    backgroundColor: '#262640',
    border: '1px solid #363658',
    borderRadius: '8px',
    padding: '16px',
    textAlign: 'center' as const,
  },
  value: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#ede8f5',
    marginBottom: '4px',
    fontFamily: "'JetBrains Mono', monospace",
  },
  label: {
    fontSize: '13px',
    color: '#a89cc8',
    fontFamily: "'Cormorant Garamond', serif",
  },
  healthRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px',
    backgroundColor: '#262640',
    border: '1px solid #363658',
    borderRadius: '8px',
  },
  healthDot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  healthLabel: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#ede8f5',
  },
}

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function TelemetryDashboard({ stats, health }: TelemetryDashboardProps) {
  return (
    <div style={styles.container}>
      <h3 style={styles.title}>📊 遥测仪表盘</h3>
      <div style={styles.grid}>
        <div style={styles.card}>
          <div style={styles.value}>{stats.totalEvents.toLocaleString()}</div>
          <div style={styles.label}>总事件数</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.value, color: stats.deadLetters > 0 ? '#e07080' : '#7ecb9a' }}>
            {stats.deadLetters.toLocaleString()}
          </div>
          <div style={styles.label}>死信数</div>
        </div>
        <div style={styles.card}>
          <div style={styles.value}>{formatUptime(stats.uptimeMs)}</div>
          <div style={styles.label}>运行时长</div>
        </div>
      </div>
      <div style={styles.healthRow}>
        <span style={{ ...styles.healthDot, backgroundColor: healthColor[health] }} />
        <span style={styles.healthLabel}>系统状态：{healthLabel[health]}</span>
      </div>
    </div>
  )
}
