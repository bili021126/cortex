/**
 * @cortex/client — WebSocket 客户端
 *
 * 订阅 engine 实时事件，支持自动重连（指数退避 + 抖动）。
 * 使用 global WebSocket（Node 22+ / Browser）或注入实现（Node 20）。
 */

import type { WSChannel, WSMessage, WSClientCommand, LlmMessageDTO } from "@cortex/protocol";
import { isWSMessage } from "@cortex/protocol";
import type { WSClientConfig } from "./types.js";
import { ConnectionError } from "./errors.js";

/** 事件处理器 */
export type WSEventHandler<T = unknown> = (message: WSMessage<T>) => void;

const DEFAULT_RECONNECT = { maxRetries: 10, backoffMs: 1000, maxBackoffMs: 30000 };

/** 生成会话 ID（优先 crypto.randomUUID，旧 Node 回退到 Math.random） */
function randomSessionId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `sess-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export class CortexWSClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<WSChannel, Set<WSEventHandler>>();
  private subscribedChannels = new Set<WSChannel>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(private readonly config: WSClientConfig) {}

  /** 建立连接 */
  connect(): void {
    this.intentionalClose = false;
    this._createSocket();
  }

  /** 断开连接 */
  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
  }

  /** 订阅通道 */
  subscribe(channels: WSChannel[]): void {
    for (const ch of channels) this.subscribedChannels.add(ch);
    this._send({ type: "subscribe", channels });
  }

  /** 取消订阅 */
  unsubscribe(channels: WSChannel[]): void {
    for (const ch of channels) this.subscribedChannels.delete(ch);
    this._send({ type: "unsubscribe", channels });
  }

  /** 注册事件监听器，返回取消函数 */
  on<T>(channel: WSChannel, handler: WSEventHandler<T>): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler as WSEventHandler<unknown>);
    return () => this.off(channel, handler as WSEventHandler<unknown>);
  }

  /** 移除事件监听器 */
  off(channel: WSChannel, handler: WSEventHandler): void {
    this.handlers.get(channel)?.delete(handler);
  }

  /** 发起流式对话，返回 sessionId */
  startChat(opts: {
    input: string;
    sessionId?: string;
    agent?: string;
    mode?: "chat" | "talk" | "plan" | "party" | "command";
    history?: LlmMessageDTO[];
  }): string {
    const sessionId = opts.sessionId ?? randomSessionId();
    this._send({
      type: "chat.start",
      sessionId,
      input: opts.input,
      mode: opts.mode ?? "chat",
      agent: opts.agent ?? "cyrene",
      history: opts.history,
    });
    return sessionId;
  }

  /** 取消对话 */
  cancelChat(sessionId: string): void {
    this._send({ type: "chat.cancel", sessionId });
  }

  /** 回复确认门请求 */
  resolveGate(requestId: string, approved: boolean): void {
    this._send({ type: "gate.resolve", requestId, approved });
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ─── 内部 ──────────────────────────────────────────

  private _createSocket(): void {
    const WSImpl = this.config.WebSocketImpl ?? globalThis.WebSocket;
    if (!WSImpl) {
      throw new ConnectionError(
        "WebSocket not available. Node 20 requires WebSocketImpl injection (e.g. from 'ws' package).",
      );
    }

    try {
      this.ws = new WSImpl(this.config.url);
    } catch (err) {
      throw new ConnectionError(`Failed to create WebSocket: ${err}`, err);
    }

    this.ws.onopen = () => this._onOpen();
    this.ws.onmessage = (event: MessageEvent) => this._onMessage(event);
    this.ws.onclose = () => this._onClose();
    this.ws.onerror = () => { /* onclose will handle cleanup */ };
  }

  private _onOpen(): void {
    this.reconnectAttempts = 0;
    // 合并初始配置通道，并在每次（重）连接后恢复全部订阅
    if (this.config.channels) {
      for (const ch of this.config.channels) this.subscribedChannels.add(ch);
    }
    if (this.subscribedChannels.size > 0) {
      this._send({ type: "subscribe", channels: [...this.subscribedChannels] });
    }
  }

  private _onMessage(event: MessageEvent): void {
    try {
      const parsed: unknown = JSON.parse(
        typeof event.data === "string" ? event.data : String(event.data),
      );
      if (!isWSMessage(parsed)) return;
      const channelHandlers = this.handlers.get(parsed.channel);
      if (channelHandlers) {
        for (const handler of channelHandlers) {
          handler(parsed);
        }
      }
    } catch {
      // 忽略无法解析的消息
    }
  }

  private _onClose(): void {
    this.ws = null;
    if (!this.intentionalClose) {
      this._scheduleReconnect();
    }
  }

  private _scheduleReconnect(): void {
    const opts = this.config.reconnect ?? DEFAULT_RECONNECT;
    if (this.reconnectAttempts >= opts.maxRetries) {
      // 重连耗尽——通知调用方，不再自动重试
      this.config.reconnect?.onFailed?.(this.reconnectAttempts);
      return;
    }

    const backoff = Math.min(
      opts.backoffMs * 2 ** this.reconnectAttempts,
      opts.maxBackoffMs,
    );
    // 加抖动避免雷群效应
    const jitter = backoff * 0.2 * Math.random();
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._createSocket();
    }, backoff + jitter);
  }

  private _send(command: WSClientCommand): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(command));
    }
  }
}
