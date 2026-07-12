import React from 'react'
import type { TaskNodeSnapshot } from '../../types'

interface TaskSliceProps {
  nodes: TaskNodeSnapshot[]
}

const statusColor: Record<string, string> = {
  pending: '#a89cc8',
  running: '#e8a0bf',
  complete: '#7ecb9a',
  failed: '#e07080',
}

const statusLabel: Record<string, string> = {
  pending: '待处理',
  running: '运行中',
  complete: '已完成',
  failed: '失败',
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
  tree: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  node: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 10px',
    borderRadius: '6px',
    fontSize: '13px',
    backgroundColor: '#262640',
    border: '1px solid transparent',
  },
  nodeRunning: {
    border: '1px solid #e8a0bf',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
  },
  nodeName: {
    color: '#ede8f5',
    fontWeight: 500,
    fontFamily: "'JetBrains Mono', monospace",
  },
  agentLabel: {
    color: '#a89cc8',
    fontSize: '11px',
    marginLeft: '4px',
  },
  duration: {
    color: '#a89cc8',
    fontSize: '11px',
    marginLeft: 'auto',
    whiteSpace: 'nowrap' as const,
  },
  indent: {
    width: '20px',
    flexShrink: 0,
  },
  empty: {
    color: '#a89cc8',
    fontSize: '13px',
    textAlign: 'center' as const,
    padding: '32px',
  },
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function buildTree(nodes: TaskNodeSnapshot[]): TaskNodeSnapshot[][] {
  // 按层 BFS——找出根节点（无 parentId 或 parentId 不存在于列表中）
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const parentIds = new Set(nodes.map((n) => n.parentId).filter(Boolean))
  const roots = nodes.filter((n) => !n.parentId || !nodeMap.has(n.parentId!))

  // 按 parentId 分组
  const childrenMap = new Map<string, TaskNodeSnapshot[]>()
  for (const n of nodes) {
    if (n.parentId) {
      if (!childrenMap.has(n.parentId)) childrenMap.set(n.parentId, [])
      childrenMap.get(n.parentId)!.push(n)
    }
  }

  // 展平成带层次深度的列表
  const result: { node: TaskNodeSnapshot; depth: number }[] = []

  function traverse(node: TaskNodeSnapshot, depth: number) {
    result.push({ node, depth })
    const children = childrenMap.get(node.id) || []
    for (const child of children) {
      traverse(child, depth + 1)
    }
  }

  for (const root of roots) {
    traverse(root, 0)
  }

  // 如果根系为空（所有节点都有不存在的 parentId），直接按原序展示
  if (result.length === 0) {
    return nodes.map((n) => [{ ...n }])
  }

  return result.map((r) => [{ ...r.node, ...{ _depth: r.depth } }] as TaskNodeSnapshot[])
}

export function TaskSlice({ nodes }: TaskSliceProps) {
  const treeItems = buildTree(nodes)

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>📋 当前任务</h3>
      {nodes.length === 0 && (
        <div style={styles.empty}>无活跃任务</div>
      )}
      <div style={styles.tree}>
        {treeItems.map((item, i) => {
          const node = item[0] as TaskNodeSnapshot & { _depth?: number }
          const depth = node._depth ?? 0
          return (
            <div
              key={node.id || i}
              style={{
                ...styles.node,
                ...(node.status === 'running' ? styles.nodeRunning : {}),
                ...(depth > 0 ? { borderLeft: '1px solid #363658' } : {}),
              }}
            >
              {/* 缩进 */}
              {Array.from({ length: depth }).map((_, j) => (
                <span key={j} style={styles.indent} />
              ))}
              <span
                style={{
                  ...styles.statusDot,
                  backgroundColor: statusColor[node.status] || '#a89cc8',
                }}
              />
              <span style={styles.nodeName}>
                {node.nodeType}
                <span style={styles.agentLabel}>{node.agent}</span>
              </span>
              <span style={{ color: statusColor[node.status], fontSize: '11px' }}>
                {statusLabel[node.status]}
              </span>
              <span style={styles.duration}>
                {formatDuration(node.durationMs)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
