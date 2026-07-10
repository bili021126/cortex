import React, { useCallback, useEffect } from 'react'
import type { PipelineEvent } from '../../types'

interface ConfirmGateProps {
  pendingEvent: PipelineEvent | null
  onDismiss: () => void
}

const reversibilityLabel: Record<string, string> = {
  '1': '低成本可逆',
  '2': '高成本可逆',
  '3': '不可逆',
}

/** ---- L3 不可逆：IDE 面板顶部红色 sticky 条 ---- */
function L3Banner({
  toolName,
  triggerSource,
  inputParams,
  handleApprove,
  onDismiss,
}: {
  toolName: string
  triggerSource: string
  inputParams: Record<string, unknown>
  handleApprove: () => void
  onDismiss: () => void
}) {
  const paramSummary = Object.keys(inputParams).length > 0
    ? JSON.stringify(inputParams).slice(0, 80)
    : ''

  return (
    <>
      <style>{`
        @keyframes l3-slide-in {
          from { transform: translateY(-100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
      <div
        style={{
          position: 'sticky',
          top: 0,
          width: '100%',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 14px',
          backgroundColor: '#e07080',
          animation: 'l3-slide-in 0.3s ease-out',
          boxShadow: '0 2px 12px rgba(224,112,128,0.3)',
        }}
      >
        <span style={{ fontSize: '16px', flexShrink: 0 }}>⚠️</span>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e1e36', flexShrink: 0 }}>
          L3 不可逆 — {toolName}
        </span>
        {paramSummary && (
          <span style={{ fontSize: '11px', color: '#5a2a30', fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
            参数: {paramSummary}
          </span>
        )}
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <button
            onClick={onDismiss}
            style={{
              padding: '4px 14px',
              border: '1px solid #5a2a30',
              borderRadius: '6px',
              backgroundColor: 'transparent',
              color: '#1e1e36',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(30,30,54,0.1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
          >
            拒绝
          </button>
          <button
            onClick={handleApprove}
            style={{
              padding: '4px 14px',
              border: '2px solid #1e1e36',
              borderRadius: '6px',
              backgroundColor: '#1e1e36',
              color: '#ede8f5',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#2e2e50'
              e.currentTarget.style.borderColor = '#2e2e50'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#1e1e36'
              e.currentTarget.style.borderColor = '#1e1e36'
            }}
          >
            ✓ 确认
          </button>
        </div>
      </div>
    </>
  )
}

/** ---- L2 高成本可逆：黄色弹窗 ---- */
function L2Modal({
  toolName,
  triggerSource,
  inputParams,
  handleApprove,
  handleDeny,
}: {
  toolName: string
  triggerSource: string
  inputParams: Record<string, unknown>
  handleApprove: () => void
  handleDeny: () => void
}) {
  return (
    <>
      <style>{`
        @keyframes l2-fade-in {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            backgroundColor: '#262640',
            borderLeft: '4px solid #e0b870',
            borderRadius: '8px',
            padding: '24px',
            minWidth: '420px',
            maxWidth: '520px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            animation: 'l2-fade-in 0.25s ease-out',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              fontSize: '18px',
              fontWeight: 700,
              color: '#e0b870',
              margin: '0 0 12px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontFamily: "'Cormorant Garamond', serif",
            }}
          >
            ⚠️ L2 高成本可逆 — 权限确认
          </div>

          <div style={{ marginBottom: '8px' }}>
            <div style={{
              fontSize: '11px',
              color: '#a89cc8',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              来源: {triggerSource}
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <div style={{
              fontSize: '11px',
              color: '#a89cc8',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              工具: {toolName}
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <div style={{
              fontSize: '11px',
              color: '#a89cc8',
              marginBottom: '4px',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              输入参数
            </div>
            <div
              style={{
                backgroundColor: '#1e1e36',
                border: '1px solid #363658',
                borderRadius: '6px',
                padding: '12px',
                fontSize: '12px',
                fontFamily: "'JetBrains Mono', monospace",
                color: '#ede8f5',
                maxHeight: '200px',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {JSON.stringify(inputParams, null, 2)}
            </div>
          </div>

          <div style={{
            fontSize: '10px',
            color: '#6a6090',
            fontFamily: "'JetBrains Mono', monospace",
            marginBottom: '16px',
          }}>
            此操作已在 PipelineObserver 中记录
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleDeny}
              style={{
                flex: 1,
                padding: '10px',
                border: '1px solid #3d3560',
                borderRadius: '8px',
                backgroundColor: 'transparent',
                color: '#e07080',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(224,112,128,0.08)'
                e.currentTarget.style.borderColor = '#e07080'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.borderColor = '#3d3560'
              }}
            >
              ✕ 拒绝
            </button>
            <button
              onClick={handleApprove}
              style={{
                flex: 1,
                padding: '10px',
                border: 'none',
                borderRadius: '8px',
                backgroundColor: '#e0b870',
                color: '#1e1e36',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#d0a860'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#e0b870'
              }}
            >
              ✓ 批准
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/** ---- L1 低成本可逆：底部提示条 ---- */
function L1Bar({
  toolName,
  triggerSource,
  handleApprove,
  handleDeny,
}: {
  toolName: string
  triggerSource: string
  handleApprove: () => void
  handleDeny: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      handleApprove()
    }, 5000)
    return () => clearTimeout(timer)
  }, [handleApprove])

  return (
    <>
      <style>{`
        @keyframes l1-slide-in {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          animation: 'l1-slide-in 0.25s ease-out',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            borderLeft: '4px solid #7ecb9a',
            backgroundColor: '#1e2e28',
            margin: '0 12px 12px',
            borderRadius: '0 8px 8px 0',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            pointerEvents: 'auto',
            boxShadow: '0 -2px 12px rgba(0,0,0,0.3)',
          }}
        >
          <span style={{ fontSize: '16px', flexShrink: 0 }}>🟢</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#7ecb9a',
                fontFamily: "'Cormorant Garamond', serif",
              }}
            >
              L1 低成本可逆 — {toolName}
            </div>
            <div style={{
              fontSize: '11px',
              color: '#8aaa98',
              marginTop: '2px',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              来源: {triggerSource}
            </div>
            <div style={{
              fontSize: '10px',
              color: '#6a8a78',
              marginTop: '4px',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              此操作已在 PipelineObserver 中记录 · 5s 后自动放行
            </div>
          </div>
          <button
            onClick={handleApprove}
            style={{
              padding: '6px 16px',
              border: '1px solid #7ecb9a',
              borderRadius: '6px',
              backgroundColor: '#7ecb9a',
              color: '#1e1e36',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#6ebb8a'
              e.currentTarget.style.borderColor = '#6ebb8a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#7ecb9a'
              e.currentTarget.style.borderColor = '#7ecb9a'
            }}
          >
            一键放行
          </button>
          <button
            onClick={handleDeny}
            style={{
              padding: '6px 12px',
              border: '1px solid #3d3560',
              borderRadius: '6px',
              backgroundColor: 'transparent',
              color: '#a89cc8',
              fontSize: '12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(160,156,200,0.08)'
              e.currentTarget.style.borderColor = '#a89cc8'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.borderColor = '#3d3560'
            }}
          >
            ✕
          </button>
        </div>
      </div>
    </>
  )
}

export function ConfirmGate({ pendingEvent, onDismiss }: ConfirmGateProps) {
  const handleApprove = useCallback(() => {
    console.log('[ConfirmGate] Approved:', pendingEvent?.payload)
    onDismiss()
  }, [pendingEvent, onDismiss])

  const handleDeny = useCallback(() => {
    console.log('[ConfirmGate] Denied:', pendingEvent?.payload)
    onDismiss()
  }, [pendingEvent, onDismiss])

  if (!pendingEvent) return null

  const payload = pendingEvent.payload
  const toolName = String(payload?.toolName || payload?.tool || '未知')
  const reversibilityLevel = Number(payload?.reversibilityLevel || 1) as 1 | 2 | 3
  const inputParams = payload?.inputParams || payload?.arguments || {}
  const triggerSource = String(payload?.triggerSource || 'interact')

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {reversibilityLevel === 3 && (
        <L3Banner
          toolName={toolName}
          triggerSource={triggerSource}
          inputParams={inputParams as Record<string, unknown>}
          handleApprove={handleApprove}
          onDismiss={onDismiss}
        />
      )}

      {reversibilityLevel === 2 && (
        <L2Modal
          toolName={toolName}
          triggerSource={triggerSource}
          inputParams={inputParams as Record<string, unknown>}
          handleApprove={handleApprove}
          handleDeny={handleDeny}
        />
      )}

      {reversibilityLevel === 1 && (
        <L1Bar
          toolName={toolName}
          triggerSource={triggerSource}
          handleApprove={handleApprove}
          handleDeny={handleDeny}
        />
      )}
    </div>
  )
  // L0 完全可逆：不渲染，交由 NotificationFeed FYI 处理
}
