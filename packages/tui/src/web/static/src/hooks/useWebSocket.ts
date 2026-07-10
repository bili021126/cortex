import { useEffect, useRef, useCallback } from 'react'

type MessageHandler = (data: unknown) => void
type StatusHandler = (connected: boolean) => void

interface UseWebSocketOptions {
  url: string
  onMessage: MessageHandler
  onStatusChange?: StatusHandler
  reconnectInterval?: number
}

export function useWebSocket({
  url,
  onMessage,
  onStatusChange,
  reconnectInterval = 3000,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close()
        return
      }
      onStatusChange?.(true)

      // 订阅三个 channel
      const subscribe = {
        type: 'subscribe',
        channels: ['pipeline', 'tui', 'state'],
      }
      ws.send(JSON.stringify(subscribe))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        onMessage(msg)
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      onStatusChange?.(false)
      // auto reconnect
      timerRef.current = setTimeout(connect, reconnectInterval)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [url, onMessage, onStatusChange, reconnectInterval])

  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return { send }
}
