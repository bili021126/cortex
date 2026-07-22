/**
 * @cortex/client — Cortex 客户端 SDK
 *
 * 三端共用的 engine 连接层。仅依赖 @cortex/protocol。
 *
 * 用法：
 *   import { CortexConnection } from "@cortex/client";
 *   const conn = new CortexConnection({ port: 3001 });
 *   const state = await conn.http.getState();
 *   conn.ws.on("state", (msg) => console.log(msg.data));
 *   conn.connect();
 *
 * @layer L1 — 仅依赖 @cortex/protocol
 */

export { CortexConnection } from "./connection.js";
export { CortexHttpClient } from "./http-client.js";
export { CortexWSClient, type WSEventHandler } from "./ws-client.js";
export { streamChat, type ChatStreamCallbacks, type ChatStreamHandle } from "./chat-stream.js";
export { ProtocolError, ConnectionError } from "./errors.js";
export type {
  HttpClientConfig,
  WSClientConfig,
  CortexConnectionConfig,
} from "./types.js";
