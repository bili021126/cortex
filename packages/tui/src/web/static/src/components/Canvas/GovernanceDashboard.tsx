import React from 'react'
import type { GovernanceSnapshot } from '../../types'

interface GovernanceDashboardProps {
  governance?: GovernanceSnapshot
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
  placeholder: {
    color: '#a89cc8',
    fontSize: '16px',
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    textAlign: 'center' as const,
    padding: '40px',
  },
  section: {
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#a89cc8',
    marginBottom: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  card: {
    backgroundColor: '#262640',
    border: '1px solid #363658',
    borderRadius: '8px',
    padding: '12px',
  },
  reportItem: {
    padding: '8px 0',
    borderBottom: '1px solid #2e2e45',
  },
  reportTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#ede8f5',
    fontFamily: "'Cormorant Garamond', serif",
  },
  reportMeta: {
    fontSize: '11px',
    color: '#7a6e98',
    marginTop: '2px',
  },
  reportConclusion: {
    fontSize: '12px',
    color: '#a89cc8',
    marginTop: '4px',
  },
  timeline: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexWrap: 'wrap' as const,
  },
  versionNode: {
    padding: '4px 10px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 600,
    backgroundColor: '#363658',
    color: '#ede8f5',
  },
  versionArrow: {
    color: '#7a6e98',
    fontSize: '12px',
  },
  violationItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    fontSize: '12px',
    color: '#e07080',
    backgroundColor: '#2e1a20',
    borderRadius: '4px',
    marginBottom: '4px',
  },
  gapIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 600,
  },
  gapActive: {
    backgroundColor: '#3a3020',
    color: '#e0b870',
    border: '1px solid #e0b870',
  },
  gapNone: {
    backgroundColor: '#1a2e22',
    color: '#7ecb9a',
    border: '1px solid #7ecb9a',
  },
  consensusText: {
    fontSize: '13px',
    color: '#ede8f5',
    fontStyle: 'italic',
    padding: '8px',
    backgroundColor: '#1e1e36',
    borderRadius: '4px',
    lineHeight: 1.5,
  },
  noViolations: {
    fontSize: '12px',
    color: '#7ecb9a',
    padding: '6px 8px',
  },
}

const severityColor: Record<string, string> = {
  low: '#e0b870',
  medium: '#e09070',
  high: '#e07080',
}

export function GovernanceDashboard({ governance }: GovernanceDashboardProps) {
  if (!governance) {
    return (
      <div style={styles.container}>
        <h3 style={styles.title}>🏛️ 治理仪表盘</h3>
        <div style={styles.placeholder}>等待自审视报告...</div>
      </div>
    )
  }

  const { auditReports, constitutionVersions, complianceViolations, docCodeGap, roundTableConsensus } = governance

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>🏛️ 治理仪表盘</h3>

      {/* 审计报告摘要 */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>📋 最近审计报告</div>
        <div style={styles.card}>
          {auditReports.length === 0 && (
            <div style={{ fontSize: '12px', color: '#7a6e98', fontStyle: 'italic' }}>
              暂无审计记录
            </div>
          )}
          {auditReports.map((report, i) => (
            <div key={i} style={styles.reportItem}>
              <div style={styles.reportTitle}>{report.title}</div>
              <div style={styles.reportMeta}>{report.date}</div>
              <div style={styles.reportConclusion}>{report.conclusion}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 宪法版本流 */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>📜 宪法版本流</div>
        <div style={{ ...styles.card, display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
          {constitutionVersions.length === 0 && (
            <div style={{ fontSize: '12px', color: '#7a6e98', fontStyle: 'italic' }}>
              暂无版本记录
            </div>
          )}
          <div style={styles.timeline}>
            {constitutionVersions.map((v, i) => (
              <React.Fragment key={v.version}>
                {i > 0 && <span style={styles.versionArrow}>→</span>}
                <span style={styles.versionNode} title={v.date}>
                  {v.version}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* 合规违规列表 */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>🚨 合规违规</div>
        <div style={styles.card}>
          {complianceViolations.length === 0 && (
            <div style={styles.noViolations}>✓ 无合规违规</div>
          )}
          {complianceViolations.map((v, i) => (
            <div key={i} style={styles.violationItem}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: severityColor[v.severity] || '#e0b870',
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1 }}>{v.rule}</span>
              <span style={{ fontSize: '10px', color: severityColor[v.severity] }}>
                {v.description}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 文档-代码 Gap 指示器 */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>🔗 文档-代码一致性</div>
        <div style={{ ...styles.gapIndicator, ...(docCodeGap ? styles.gapActive : styles.gapNone) }}>
          {docCodeGap ? (
            <>⚠️ 存在文档-代码 Gap</>
          ) : (
            <>✓ 文档与代码一致</>
          )}
        </div>
      </div>

      {/* 圆桌共识摘要 */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>🔄 圆桌共识</div>
        <div style={styles.card}>
          <div style={styles.consensusText}>
            {roundTableConsensus || '暂无共识记录'}
          </div>
        </div>
      </div>
    </div>
  )
}
