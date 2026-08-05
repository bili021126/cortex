/**
 * @cortex/client — 统一连接管理器
 *
 * 组合 HTTP 客户端和 WebSocket 客户端，提供单一入口。
 * 三端（TUI / WebUI / Desktop）共用此类连接 engine daemon。
 */

import { CortexHttpClient } from "./http-client.js";
import { CortexWSClient } from "./ws-client.js";
import type { CortexConnectionConfig } from "./types.js";

export class CortexConnection {
  readonly http: CortexHttpClient;
  readonly ws: CortexWSClient;

  constructor(config?: CortexConnectionConfig) {
    const host = config?.host ?? "localhost";
    const port = config?.port ?? 3210;
    const protocol = config?.protocol ?? "http";
    const wsProtocol = config?.wsProtocol ?? "ws";

    this.http = new CortexHttpClient({
      baseUrl: `${protocol}://${host}:${port}`,
      headers: config?.headers,
      timeoutMs: config?.timeoutMs,
    });

    this.ws = new CortexWSClient({
      url: `${wsProtocol}://${host}:${port}`,
      channels: config?.channels,
      reconnect: config?.reconnect,
      sendQueueLimit: config?.sendQueueLimit,
      // R13-N3：WS 鉴权令牌透传（daemon P0-3 后必填——否则 401）
      authToken: config?.authToken,
      WebSocketImpl: config?.WebSocketImpl,
    });
  }

  /** 建立 WebSocket 连接（HTTP 是无状态的，无需 connect） */
  connect(): void {
    this.ws.connect();
  }

  /** 断开所有连接 */
  disconnect(): void {
    this.ws.disconnect();
  }

  get connected(): boolean {
    return this.ws.connected;
  }
}
