import React, { Component, ErrorInfo, ReactNode } from 'react'
import { useCortexState } from './hooks/useCortexState'
import { Layout } from './components/Layout'
import { EventPipeline } from './components/Canvas/EventPipeline'
import { AgentForest } from './components/Canvas/AgentForest'
import { TelemetryDashboard } from './components/Canvas/TelemetryDashboard'
import { GovernanceDashboard } from './components/Canvas/GovernanceDashboard'
import { TaskSlice } from './components/IdePanel/TaskSlice'
import { ConfirmGate } from './components/IdePanel/ConfirmGate'
import { NotificationFeed } from './components/IdePanel/NotificationFeed'
import { ApiUsageCard } from './components/IdePanel/ApiUsageCard'

// ── 错误边界 ──────────────────────────────────────
interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}
interface ErrorBoundaryState {
  hasError: boolean
}
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error.message, info.componentStack)
  }
  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div
            style={{
              padding: '24px',
              color: '#e07080',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '13px',
              textAlign: 'center' as const,
            }}
          >
            ⚠️ 渲染异常 —{' '}
            <button
              onClick={() => this.setState({ hasError: false })}
              style={{
                background: 'none',
                border: '1px solid #e07080',
                color: '#e07080',
                padding: '4px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              重试
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}

// ── Canvas（左面板） ──────────────────────────────
function Canvas({ state, pipelineEvents, governance, agentLogs }: ReturnType<typeof useCortexState>) {
  return (
    <div style={{ minHeight: '100%' }}>
      <TelemetryDashboard stats={state.stats} health={state.health} />
      <GovernanceDashboard governance={governance} />
      <EventPipeline events={pipelineEvents} />
      <AgentForest agents={state.agents} agentLogs={agentLogs} />
    </div>
  )
}

// ── IdePanel（右面板） ────────────────────────────
function IdePanel({ state, pipelineEvents, pendingPermission, clearPermission, tokenUsage }: ReturnType<typeof useCortexState>) {
  return (
    <div style={{ minHeight: '100%' }}>
      <TaskSlice nodes={state.nodes} />
      <ApiUsageCard tokenUsage={tokenUsage} />
      <NotificationFeed events={pipelineEvents} />
      <ConfirmGate
        pendingEvent={pendingPermission}
        onDismiss={clearPermission}
      />
    </div>
  )
}

// ── LoadingScreen ─────────────────────────────────
function LoadingScreen() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: '#1e1e36',
        color: '#e0b870',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        gap: '16px',
      }}
    >
      <div style={{ fontSize: '24px' }}>⟳</div>
      <div style={{ fontSize: '16px', fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic' }}>正在连接 Cortex...</div>
      <div
        style={{
          width: '200px',
          height: '2px',
          backgroundColor: '#363658',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: '30%',
            height: '100%',
            backgroundColor: '#e0b870',
            borderRadius: '2px',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: translateX(0); opacity: 0.4; }
          50% { transform: translateX(200px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ── ReconnectingBanner ────────────────────────────
function ReconnectingBanner() {
  return (
    <div
      style={{
        position: 'fixed' as const,
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9998,
        backgroundColor: '#3a3020',
        color: '#e0b870',
        padding: '6px 16px',
        fontSize: '12px',
        fontFamily: "'JetBrains Mono', monospace",
        textAlign: 'center' as const,
        borderBottom: '1px solid #e0b870',
      }}
    >
      ⟳ 连接中断，正在重连...
    </div>
  )
}

// ── App ───────────────────────────────────────────
export default function App() {
  const cortex = useCortexState()

  // 快速诊断日志
  console.log(
    '[App] connected:', cortex.connected,
    '| hasData:', cortex.hasReceivedData,
    '| events:', cortex.pipelineEvents.length,
    '| agents:', cortex.state.agents?.length,
    '| nodes:', cortex.state.nodes?.length,
  )

  // 从未连接过（首次加载）→ LoadingScreen
  if (!cortex.connected && !cortex.hasReceivedData) {
    return <LoadingScreen />
  }

  // 曾经连通过但断开了 → 保留 UI + 顶部重连提示
  return (
    <>
      {!cortex.connected && cortex.hasReceivedData && <ReconnectingBanner />}
      <Layout
        left={
          <ErrorBoundary>
            <Canvas {...cortex} />
          </ErrorBoundary>
        }
        right={
          <ErrorBoundary>
            <IdePanel {...cortex} />
          </ErrorBoundary>
        }
      />
    </>
  )
}
