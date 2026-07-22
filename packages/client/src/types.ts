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
}

/** WebSocket 客户端配置 */
export interface WSClientConfig {
  /** WebSocket URL（如 "ws://localhost:3001"） */
  url: string;
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
  WebSocketImpl?: typeof WebSocket;
}
