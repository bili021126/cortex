/**
 * @cortex/client — 配置类型
 */

import type { WSChannel } from "@cortex/protocol";

/** HTTP 客户端配置 */
export interface HttpClientConfig {
  /** 基础 URL（如 "http://localhost:3001"） */
  baseUrl: string;
  /** 额外请求头 */
  headers?: Record<string, string>;
  /** 请求超时（毫秒，默认 0 = 无超时；B5） */
  timeoutMs?: number;
}

/** WebSocket 客户端配置 */
export interface WSClientConfig {
  /** WebSocket URL（如 "ws://localhost:3001"） */
  url: string;
  /** R12-P0-3：WS 鉴权令牌（daemon 的 CORTEX_DAEMON_WS_TOKEN）——连接时拼到 URL query */
  authToken?: string;
  /** 初始订阅的通道 */
  channels?: WSChannel[];
  /** 重连策略 */
  reconnect?: {
    maxRetries: number;
    backoffMs: number;
    maxBackoffMs: number;
    /** 重连耗尽后的回调（不再自动重试） */
    onFailed?: (attempts: number) => void;
  };
  /** 发送缓冲上限（B4：非 OPEN 时排队等待的命令数，默认 100，超出丢最旧） */
  sendQueueLimit?: number;
  /** WebSocket 实现注入（Node 20 无全局 WebSocket 时使用） */
  WebSocketImpl?: typeof WebSocket;
}

/** 统一连接配置 */
export interface CortexConnectionConfig {
  host?: string;
  port?: number;
  protocol?: "http" | "https";
  wsProtocol?: "ws" | "wss";
  headers?: Record<string, string>;
  channels?: WSChannel[];
  reconnect?: WSClientConfig["reconnect"];
  sendQueueLimit?: number;
  timeoutMs?: number;
  // R13-N3：WS 鉴权令牌（daemon P0-3 后必填——否则 WS 401）
  authToken?: string;
  WebSocketImpl?: typeof WebSocket;
}
