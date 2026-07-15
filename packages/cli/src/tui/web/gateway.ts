/**
 * tui/web/gateway.ts — WS Gateway
 *
 * 手写 WebSocket（RFC 6455）握手 + 帧解析。零外部依赖。
 * 将 PipelineObserver 事件和 TuiEventBus 事件桥接到浏览器。
 *
 * @module tui/web/gateway
 */

import * as http from "node:http";
import * as crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { IPipelineObserver, ObservableEvent } from "@cortex/shared";
import { PipelinePriority } from "@cortex/shared";
import type { TuiEventBus, TuiEventListener } from "../event-bus.js";
import type { TuiEvent } from "../types.js";

// ─── 常量 ────────────────────────────────────────

/** WebSocket GUID（RFC 6455） */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** 解析 WS 帧时的最大 payload 长度（256KB） */
const MAX_FRAME_PAYLOAD = 256 * 1024;

// ─── 内部类型 ────────────────────────────────────

/** WebSocket 连接状态 */
enum WS_READY_STATE {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

/** WebSocket 操作码 */
enum OPCODE {
  CONTINUATION = 0x00,
  TEXT = 0x01,
  BINARY = 0x02,
  CLOSE = 0x08,
  PING = 0x09,
  PONG = 0x0a,
}

/** 客户端订阅 */
interface Subscription {
  channels: Set<string>;
}

/** 内部 WS 连接 */
interface WSConnection {
  socket: import("node:net").Socket;
  readyState: WS_READY_STATE;
  subscription: Subscription;
}

// ─── WSGateway ────────────────────────────────────

export class WSGateway {
  private _server: http.Server | null = null;

  /** 获取底层 http.Server 实例（仅在 start() 后可用） */
  get server(): http.Server | null {
    return this._server;
  }
  private connections = new Set<WSConnection>();
  private readonly port: number;
  private observerCleanup: (() => void)[] = [];
  private tuiCleanup: (() => void)[] = [];

  constructor(port: number = 3001) {
    this.port = port;
  }

  /**
   * 启动 HTTP 服务器并等待 WS 升级请求。
   */
  async start(): Promise<void> {
    return new Promise<void>((resolve) => {
      // 使用 new http.Server() 而非 createServer(cb)，避免重复的 'request' 监听器冲突
      this._server = new http.Server();

      // 通过 'upgrade' 事件处理 WebSocket 升级请求（标准 Node.js 模式）
      // HTTP 请求由 index.ts 中的 'request' 监听器处理（API 路由 + 静态文件）
      this._server.on("upgrade", (req: IncomingMessage, socket: import("node:net").Socket, head: Buffer) => {
        this._handleUpgradeV2(req, socket, head);
      });

      this._server.listen(this.port, () => {
        resolve();
      });
    });
  }

  /**
   * 停止服务器并断开所有连接。
   */
  async stop(): Promise<void> {
    // 取消所有订阅
    for (const cleanup of this.observerCleanup) cleanup();
    for (const cleanup of this.tuiCleanup) cleanup();
    this.observerCleanup = [];
    this.tuiCleanup = [];

    // 关闭所有 WS 连接
    for (const conn of this.connections) {
      try {
        this._closeConnection(conn, 1001, "Server shutting down");
      } catch {
        // 静默
      }
    }
    this.connections.clear();

    // 关闭 HTTP 服务器
    return new Promise<void>((resolve) => {
      if (this._server) {
        this._server.close(() => resolve());
        this._server = null;
      } else {
        resolve();
      }
    });
  }

  /**
   * 把 PipelineObserver 事件桥接到 WebSocket。
   * 订阅所有优先级，事件通过 "pipeline" channel 推送。
   */
  bridgeObserver(observer: IPipelineObserver): void {
    const handler = (event: ObservableEvent): void => {
      this.broadcast("pipeline", {
        type: event.type,
        priority: event.priority,
        payload: event.payload,
        timestamp: event.timestamp,
        requestId: event.requestId,
        notificationType: event.notificationType,
      });
    };

    observer.on(PipelinePriority.CRITICAL, handler);
    observer.on(PipelinePriority.HIGH, handler);
    observer.on(PipelinePriority.NORMAL, handler);

    this.observerCleanup.push(() => {
      observer.off(PipelinePriority.CRITICAL, handler);
      observer.off(PipelinePriority.HIGH, handler);
      observer.off(PipelinePriority.NORMAL, handler);
    });
  }

  /**
   * 把 TuiEventBus 事件桥接到 WebSocket。
   * 所有 TUI 事件通过 "tui" channel 推送。
   */
  bridgeTuiEvents(tuiEventBus: TuiEventBus): void {
    const listener: TuiEventListener = (event: TuiEvent) => {
      this.broadcast("tui", event);
    };

    const unsubscribe = tuiEventBus.on("*", listener);
    this.tuiCleanup.push(unsubscribe);
  }

  /**
   * 广播消息给所有订阅了指定 channel 的客户端。
   */
  broadcast(channel: string, payload: unknown): void {
    const message = JSON.stringify({ channel, data: payload });
    for (const conn of this.connections) {
      if (conn.readyState !== WS_READY_STATE.OPEN) continue;
      if (conn.subscription.channels.size > 0 && !conn.subscription.channels.has(channel)) continue;
      this._sendFrame(conn, OPCODE.TEXT, Buffer.from(message, "utf-8"));
    }
  }

  // ── 私有方法 ────────────────────────────────────

  /** 处理 HTTP → WebSocket 升级请求（通过 'upgrade' 事件） */
  private _handleUpgradeV2(req: IncomingMessage, socket: import("node:net").Socket, head: Buffer): void {
    const key = req.headers["sec-websocket-key"];
    if (!key || Array.isArray(key)) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }

    const accept = crypto
      .createHash("sha1")
      .update(key + WS_GUID, "utf-8")
      .digest("base64");

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "Access-Control-Allow-Origin: http://localhost\r\n" +
      "\r\n",
    );

    socket.setTimeout(0);
    socket.setNoDelay(true);

    const conn: WSConnection = {
      socket,
      readyState: WS_READY_STATE.OPEN,
      subscription: { channels: new Set() },
    };

    this.connections.add(conn);

    // 监听数据帧
    socket.on("data", (data: Buffer) => {
      this._handleFrame(conn, data);
    });

    socket.on("close", () => {
      conn.readyState = WS_READY_STATE.CLOSED;
      this.connections.delete(conn);
    });

    socket.on("error", (err) => {
      console.warn("[WSGateway] socket error:", err instanceof Error ? err.message : String(err));
      conn.readyState = WS_READY_STATE.CLOSED;
      this.connections.delete(conn);
    });
  }

  /** 处理 HTTP → WebSocket 升级请求 */
  private _handleUpgrade(req: IncomingMessage, res: ServerResponse): void {
    const key = req.headers["sec-websocket-key"];
    if (!key || Array.isArray(key)) {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    const accept = crypto
      .createHash("sha1")
      .update(key + WS_GUID, "utf-8")
      .digest("base64");

    res.writeHead(101, {
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Accept": accept,
      "Access-Control-Allow-Origin": "http://localhost",
    });

    // TypeScript 类型体操：socket 在 writeHead 后可用
    const socket = res.socket!;
    socket.setTimeout(0);
    socket.setNoDelay(true);

    const conn: WSConnection = {
      socket,
      readyState: WS_READY_STATE.OPEN,
      subscription: { channels: new Set() },
    };

    this.connections.add(conn);

    // 监听数据帧
    socket.on("data", (data: Buffer) => {
      this._handleFrame(conn, data);
    });

    socket.on("close", () => {
      conn.readyState = WS_READY_STATE.CLOSED;
      this.connections.delete(conn);
    });

    socket.on("error", (err) => {
      console.warn("[WSGateway] upgraded socket error:", err instanceof Error ? err.message : String(err));
      conn.readyState = WS_READY_STATE.CLOSED;
      this.connections.delete(conn);
    });
  }

  /** 处理收到的 WS 帧 */
  private _handleFrame(conn: WSConnection, data: Buffer): void {
    if (data.length < 2) return;

    const opcode = data[0]! & 0x0f;
    const masked = (data[1]! & 0x80) !== 0;
    let payloadLength = data[1]! & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (data.length < 4) return;
      payloadLength = data.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (data.length < 10) return;
      // 只处理 64 位长度中的低 32 位（够用）
      payloadLength = Number(data.readBigUInt64BE(offset));
      offset += 8;
    }

    if (payloadLength > MAX_FRAME_PAYLOAD) {
      this._closeConnection(conn, 1009, "Frame too large");
      return;
    }

    // 读取 mask key
    let maskKey: Buffer | null = null;
    if (masked) {
      if (data.length < offset + 4) return;
      maskKey = data.subarray(offset, offset + 4);
      offset += 4;
    }

    if (data.length < offset + payloadLength) return;
    let payload = data.subarray(offset, offset + payloadLength);

    // unmask — 4 字节块 XOR，避免逐字节回调（~100x 性能差距）
    if (maskKey) {
      const len = payload.length;
      const buf = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i += 4) {
        buf[i] = payload[i]! ^ maskKey[0]!;
        if (i + 1 < len) buf[i + 1] = payload[i + 1]! ^ maskKey[1]!;
        if (i + 2 < len) buf[i + 2] = payload[i + 2]! ^ maskKey[2]!;
        if (i + 3 < len) buf[i + 3] = payload[i + 3]! ^ maskKey[3]!;
      }
      payload = buf;
    }

    switch (opcode) {
      case OPCODE.TEXT: {
        const text = payload.toString("utf-8");
        this._handleMessage(conn, text);
        break;
      }
      case OPCODE.PING:
        this._sendFrame(conn, OPCODE.PONG, payload);
        break;
      case OPCODE.CLOSE: {
        let code = 1000;
        let reason = "";
        if (payload.length >= 2) {
          code = payload.readUInt16BE(0);
          reason = payload.subarray(2).toString("utf-8");
        }
        this._closeConnection(conn, code, reason);
        break;
      }
      // BINARY / CONTINUATION: 忽略
    }
  }

  /** 处理 WS 文本消息（JSON 命令） */
  private _handleMessage(conn: WSConnection, text: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      // 非 JSON 消息忽略
      return;
    }

    if (typeof msg !== "object" || msg === null) return;
    const { type, channels } = msg as Record<string, unknown>;

    if (type === "subscribe" && Array.isArray(channels)) {
      for (const ch of channels) {
        if (typeof ch === "string") {
          conn.subscription.channels.add(ch);
        }
      }
    }

    if (type === "unsubscribe" && Array.isArray(channels)) {
      for (const ch of channels) {
        if (typeof ch === "string") {
          conn.subscription.channels.delete(ch);
        }
      }
    }

    // 确认订阅
    this._sendFrame(
      conn,
      OPCODE.TEXT,
      Buffer.from(
        JSON.stringify({
          channel: "system",
          data: {
            type: "subscription_ack",
            channels: [...conn.subscription.channels],
          },
        }),
        "utf-8",
      ),
    );
  }

  /** 发送 WS 帧 */
  private _sendFrame(conn: WSConnection, opcode: OPCODE, payload: Buffer): void {
    if (conn.readyState !== WS_READY_STATE.OPEN) return;

    const header: number[] = [0x80 | opcode]; // FIN + opcode
    const len = payload.length;

    if (len < 126) {
      header.push(len);
    } else if (len < 65536) {
      header.push(126);
      header.push((len >> 8) & 0xff);
      header.push(len & 0xff);
    } else {
      header.push(127);
      const bigLen = BigInt(len);
      for (let i = 7; i >= 0; i--) {
        header.push(Number((bigLen >> BigInt(i * 8)) & BigInt(0xff)));
      }
    }

    try {
      conn.socket.write(Buffer.from(header));
      conn.socket.write(payload);
    } catch {
      conn.readyState = WS_READY_STATE.CLOSED;
      this.connections.delete(conn);
    }
  }

  /** 关闭连接 */
  private _closeConnection(conn: WSConnection, code: number, reason: string): void {
    if (conn.readyState === WS_READY_STATE.CLOSED) return;
    conn.readyState = WS_READY_STATE.CLOSING;

    // 发送关闭帧
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason, "utf-8"));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2, "utf-8");
    this._sendFrame(conn, OPCODE.CLOSE, payload);

    try {
      conn.socket.end();
    } catch {
      // 静默
    }
    conn.readyState = WS_READY_STATE.CLOSED;
    this.connections.delete(conn);
  }
}
