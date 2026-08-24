/**
 * main/ws-client.ts — daemon WS 客户端（通知铃接真）
 *
 * 连接 daemon 的 WS（http://127.0.0.1:3210），接收 pipeline/notification
 * 频道事件，转发给 renderer（notification:event）——未读数 +1。
 *
 * 令牌：env CORTEX_DAEMON_WS_TOKEN（未配置时不连接——静默降级）
 */
export class DaemonWsClient {
  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly onEvent: (channel: string, data: unknown) => void,
    private readonly port = 3210,
  ) {}

  start(): void {
    const token = process.env["CORTEX_DAEMON_WS_TOKEN"];
    // 令牌未配置——daemon 可能随机生成了令牌，无法连接（静默降级为静态通知）
    if (!token) return;
    const url = `ws://127.0.0.1:${this.port}?token=${encodeURIComponent(token)}`;
    try {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        // 连接成功——订阅 pipeline/notification/gate 频道（显式订阅，广播只发订阅者）
        ws.send(JSON.stringify({ type: "subscribe", channels: ["pipeline", "notification", "gate"] }));
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { channel?: string; data?: unknown };
          if (msg.channel) {
            // D7a：通知 ack 闭环——ackRequired 的通知立即回执（S2-12 断链修复）
            if (msg.channel === "notification") {
              const d = msg.data as { type?: string; requestId?: string; ackRequired?: boolean };
              if (d?.type === "notification.pushed" && d.ackRequired && d.requestId) {
                this.send({ type: "notification.ack", requestId: d.requestId, approved: true });
              }
            }
            this.onEvent(msg.channel, msg.data);
          }
        } catch { /* 非 JSON 帧忽略 */ }
      };
      ws.onclose = () => {
        this.ws = null;
        if (!this.closed) this.scheduleRetry();
      };
      ws.onerror = () => {
        try { ws.close(); } catch { /* 已关闭 */ }
      };
    } catch {
      // 连接失败——不重试（daemon 未启动）
    }
  }

  /** 发送 WS 命令（D7a：notification.ack 等回执通道） */
  send(msg: object): void {
    try { this.ws?.send(JSON.stringify(msg)); } catch { /* 连接已断——静默 */ }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.closed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.start();
    }, 15_000);
  }

  stop(): void {
    this.closed = true;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    try { this.ws?.close(); } catch { /* 已关闭 */ }
    this.ws = null;
  }
}
