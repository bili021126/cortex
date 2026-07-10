import React, { useState } from 'react'
import type { TokenUsageSummary } from '../../types'

interface ApiUsageCardProps {
  tokenUsage?: TokenUsageSummary
}

type TabKey = 'all' | 'normal' | 'self-review' | 'solo-fight'

const tabLabels: Record<TabKey, string> = {
  all: '全部',
  normal: '正常任务',
  'self-review': '自审视',
  'solo-fight': 'Solo-Fight',
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
  overviewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
    marginBottom: '16px',
  },
  overviewCard: {
    backgroundColor: '#262640',
    border: '1px solid #363658',
    borderRadius: '8px',
    padding: '14px',
    textAlign: 'center' as const,
  },
  overviewValue: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#ede8f5',
    fontFamily: "'JetBrains Mono', monospace",
    marginBottom: '4px',
  },
  overviewLabel: {
    fontSize: '11px',
    color: '#a89cc8',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  placeholder: {
    color: '#a89cc8',
    fontSize: '16px',
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    textAlign: 'center' as const,
    padding: '40px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace",
    marginBottom: '12px',
  },
  th: {
    textAlign: 'left' as const,
    padding: '8px 6px',
    color: '#a89cc8',
    borderBottom: '1px solid #363658',
    fontWeight: 600,
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
  },
  td: {
    padding: '8px 6px',
    color: '#ede8f5',
    borderBottom: '1px solid #2e2e45',
  },
  tabsContainer: {
    display: 'flex',
    gap: '4px',
    marginBottom: '8px',
  },
  tab: {
    padding: '6px 14px',
    borderRadius: '6px',
    border: '1px solid #363658',
    backgroundColor: 'transparent',
    color: '#a89cc8',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  tabActive: {
    backgroundColor: '#363658',
    color: '#ede8f5',
    border: '1px solid #5a4e78',
  },
  tabDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed',
  },
  noData: {
    fontSize: '12px',
    color: '#7a6e98',
    fontStyle: 'italic',
    textAlign: 'center' as const,
    padding: '20px',
  },
}

export function ApiUsageCard({ tokenUsage }: ApiUsageCardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('all')

  if (!tokenUsage) {
    return (
      <div style={styles.container}>
        <h3 style={styles.title}>⚡ API 用量</h3>
        <div style={styles.placeholder}>等待 Token 统计数据...</div>
      </div>
    )
  }

  const { totalTokens, totalCost, cacheHitRate, byAgent } = tokenUsage

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>⚡ API 用量</h3>

      {/* 顶部总览 */}
      <div style={styles.overviewGrid}>
        <div style={styles.overviewCard}>
          <div style={styles.overviewValue}>
            {totalTokens.toLocaleString()}
          </div>
          <div style={styles.overviewLabel}>总 Token</div>
        </div>
        <div style={styles.overviewCard}>
          <div style={{ ...styles.overviewValue, color: '#e0b870' }}>
            ${totalCost.toFixed(4)}
          </div>
          <div style={styles.overviewLabel}>总成本</div>
        </div>
        <div style={styles.overviewCard}>
          <div style={{ ...styles.overviewValue, color: '#7ecb9a' }}>
            {(cacheHitRate * 100).toFixed(1)}%
          </div>
          <div style={styles.overviewLabel}>缓存命中率</div>
        </div>
      </div>

      {/* 按 Agent 分解表格 */}
      {byAgent.length === 0 ? (
        <div style={styles.noData}>暂无 Agent 级 Token 数据</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Agent</th>
              <th style={styles.th}>Prompt</th>
              <th style={styles.th}>Completion</th>
              <th style={styles.th}>Cost</th>
              <th style={styles.th}>Cache</th>
            </tr>
          </thead>
          <tbody>
            {byAgent.map((agent) => (
              <tr key={agent.agentName}>
                <td style={styles.td}>{agent.agentName}</td>
                <td style={styles.td}>{agent.promptTokens.toLocaleString()}</td>
                <td style={styles.td}>{agent.completionTokens.toLocaleString()}</td>
                <td style={{ ...styles.td, color: '#e0b870' }}>
                  ${agent.cost.toFixed(4)}
                </td>
                <td style={{ ...styles.td, color: '#7ecb9a' }}>
                  {agent.cacheHit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 底部 Tab 切换 */}
      <div style={styles.tabsContainer}>
        {(Object.keys(tabLabels) as TabKey[]).map((tab) => {
          const isDisabled = tab === 'self-review' || tab === 'solo-fight'
          return (
            <button
              key={tab}
              style={{
                ...styles.tab,
                ...(activeTab === tab ? styles.tabActive : {}),
                ...(isDisabled ? styles.tabDisabled : {}),
              }}
              disabled={isDisabled}
              onClick={() => setActiveTab(tab)}
            >
              {tabLabels[tab]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
