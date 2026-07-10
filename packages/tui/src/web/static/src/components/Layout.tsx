import React from 'react'

interface LayoutProps {
  left: React.ReactNode
  right: React.ReactNode
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: '100vh',
    width: '100vw',
    backgroundColor: '#1e1e36',
    color: '#ede8f5',
    overflow: 'hidden',
    fontFamily: "'JetBrains Mono', monospace",
    gap: '8px',
  },
  left: {
    flex: '0 0 55%',
    overflowY: 'auto',
    minHeight: '100vh',
    borderRight: '1px solid #363658',
  },
  right: {
    flex: '1',
    overflowY: 'auto',
    minHeight: '100vh',
  },
}

export function Layout({ left, right }: LayoutProps) {
  return (
    <div style={styles.container}>
      <div style={styles.left}>{left}</div>
      <div style={styles.right}>{right}</div>
    </div>
  )
}
