/**
 * @cortex/server — WS Gateway
 *
 * Hand-rolled WebSocket (RFC 6455) handshake + frame parsing. Zero external deps.
 * Adapted from cli/src/tui/web/gateway.ts for daemon use:
 * - Removed TuiEventBus / IPipelineObserver bridging (wired externally by daemon.ts)
 * - Added onCommand callback for parsed JSON messages
 * - Added sendTo(connId, channel, data) for targeted delivery
 * - Added id field to WSConnection
 *
 * @module ws/gateway
 */

import * as crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { WSSubscriptionAck } from "@cortex/protocol";

// ─── Constants ────────────────────────────────────────

/** WebSocket GUID (RFC 6455) */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Max payload length when parsing WS frames (256KB) */
const MAX_FRAME_PAYLOAD = 256 * 1024;

// ─── Internal types ────────────────────────────────────

/** WebSocket connection state */
enum WS_READY_STATE {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

/** WebSocket opcodes */
enum OPCODE {
  CONTINUATION = 0x00,
  TEXT = 0x01,
  BINARY = 0x02,
  CLOSE = 0x08,
  PING = 0x09,
  PONG = 0x0a,
}

/** Client subscription */
interface Subscription {
  channels: Set<string>;
}

/** WS connection with unique id */
export interface WSConnection {
  id: string;
  socket: Socket;
  readyState: WS_READY_STATE;
  subscription: Subscription;
}

/** Command handler callback */
export type OnCommandFn = (connId: string, msg: unknown) => void;

/** WSGateway options */
export interface WSGatewayOptions {
  onCommand?: OnCommandFn;
  /** R12-P0-3：WS 连接令牌——配置后 handleUpgrade 校验 query token，拒绝未携带/不匹配的连接 */
  authToken?: string;
}

// ─── WSGateway ────────────────────────────────────────

export class WSGateway {
  private connections = new Map<string, WSConnection>();
  private readonly onCommand: OnCommandFn | undefined;
  private readonly authToken: string | undefined;

  constructor(options: WSGatewayOptions = {}) {
    this.onCommand = options.onCommand;
    this.authToken = options.authToken;
  }

  /** R12-P0-3：查询指定连接是否订阅了某频道（gate.resolve 的来源校验） */
  hasChannel(connId: string, channel: string): boolean {
    const conn = this.connections.get(connId);
    return conn?.subscription.channels.has(channel) ?? false;
  }

  /**
   * Handle an HTTP upgrade request (called from http.Server 'upgrade' event).
   */
  handleUpgrade(req: IncomingMessage, socket: Socket, _head: Buffer): void {
    // R12-P0-3：令牌鉴权——配置了 authToken 时校验 query token（挡任意本地进程/网页 CSWSH 代批）
    if (this.authToken) {
      const query = (req.url ?? "").split("?")[1] ?? "";
      const token = new URLSearchParams(query).get("token");
      if (token !== this.authToken) {
        socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
        return;
      }
    }
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

    const connId = crypto.randomUUID();
    const conn: WSConnection = {
      id: connId,
      socket,
      readyState: WS_READY_STATE.OPEN,
      subscription: { channels: new Set() },
    };

    this.connections.set(connId, conn);

    // Listen for data frames
    socket.on("data", (data: Buffer) => {
      this._handleFrame(conn, data);
    });

    socket.on("close", () => {
      conn.readyState = WS_READY_STATE.CLOSED;
      this.connections.delete(connId);
    });

    socket.on("error", (err) => {
      console.warn("[WSGateway] socket error:", err instanceof Error ? err.message : String(err));
      conn.readyState = WS_READY_STATE.CLOSED;
      this.connections.delete(connId);
    });
  }

  /**
   * Stop the gateway: close all connections.
   */
  async stop(): Promise<void> {
    for (const conn of this.connections.values()) {
      try {
        this._closeConnection(conn, 1001, "Server shutting down");
      } catch {
        // silent
      }
    }
    this.connections.clear();
  }

  /**
   * Broadcast a message to all clients subscribed to the given channel.
   */
  broadcast(channel: string, payload: unknown): void {
    const message = JSON.stringify({ channel, data: payload });
    for (const conn of this.connections.values()) {
      if (conn.readyState !== WS_READY_STATE.OPEN) continue;
      if (conn.subscription.channels.size > 0 && !conn.subscription.channels.has(channel)) continue;
      this._sendFrame(conn, OPCODE.TEXT, Buffer.from(message, "utf-8"));
    }
  }

  /**
   * Send a message to a specific connection by ID.
   */
  sendTo(connId: string, channel: string, data: unknown): void {
    const conn = this.connections.get(connId);
    if (conn?.readyState !== WS_READY_STATE.OPEN) return;
    const message = JSON.stringify({ channel, data });
    this._sendFrame(conn, OPCODE.TEXT, Buffer.from(message, "utf-8"));
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  // ── Private methods ────────────────────────────────────

  /** Handle incoming WS frame */
  private _handleFrame(conn: WSConnection, data: Buffer): void {
    if (data.length < 2) return;

    const byte0 = data[0] ?? 0;
    const byte1 = data[1] ?? 0;
    const opcode = byte0 & 0x0f;
    const masked = (byte1 & 0x80) !== 0;
    let payloadLength = byte1 & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (data.length < 4) return;
      payloadLength = data.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (data.length < 10) return;
      // Only handle low 32 bits of 64-bit length (sufficient)
      payloadLength = Number(data.readBigUInt64BE(offset));
      offset += 8;
    }

    if (payloadLength > MAX_FRAME_PAYLOAD) {
      this._closeConnection(conn, 1009, "Frame too large");
      return;
    }

    // Read mask key
    let maskKey: Buffer | null = null;
    if (masked) {
      if (data.length < offset + 4) return;
      maskKey = data.subarray(offset, offset + 4);
      offset += 4;
    }

    if (data.length < offset + payloadLength) return;
    let payload = data.subarray(offset, offset + payloadLength);

    // Unmask — 4-byte block XOR for performance
    if (maskKey) {
      const len = payload.length;
      const buf = Buffer.allocUnsafe(len);
      const m0 = maskKey[0] ?? 0;
      const m1 = maskKey[1] ?? 0;
      const m2 = maskKey[2] ?? 0;
      const m3 = maskKey[3] ?? 0;
      for (let i = 0; i < len; i += 4) {
        buf[i] = (payload[i] ?? 0) ^ m0;
        if (i + 1 < len) buf[i + 1] = (payload[i + 1] ?? 0) ^ m1;
        if (i + 2 < len) buf[i + 2] = (payload[i + 2] ?? 0) ^ m2;
        if (i + 3 < len) buf[i + 3] = (payload[i + 3] ?? 0) ^ m3;
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
      // BINARY / CONTINUATION: ignore
    }
  }

  /** Handle WS text message (JSON command) */
  private _handleMessage(conn: WSConnection, text: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      // Non-JSON message — log warning for observability
      console.warn("[WSGateway] 收到无法解析的 WS 消息（非 JSON）");
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
      // Acknowledge subscription
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
          } satisfies WSSubscriptionAck),
          "utf-8",
        ),
      );
      return;
    }

    if (type === "unsubscribe" && Array.isArray(channels)) {
      for (const ch of channels) {
        if (typeof ch === "string") {
          conn.subscription.channels.delete(ch);
        }
      }
      // Acknowledge unsubscription
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
          } satisfies WSSubscriptionAck),
          "utf-8",
        ),
      );
      return;
    }

    // Forward non-subscribe/unsubscribe commands to the onCommand callback
    if (this.onCommand) {
      this.onCommand(conn.id, msg);
    }
  }

  /** Send WS frame */
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
      this.connections.delete(conn.id);
    }
  }

  /** Close connection */
  private _closeConnection(conn: WSConnection, code: number, reason: string): void {
    if (conn.readyState === WS_READY_STATE.CLOSED) return;
    conn.readyState = WS_READY_STATE.CLOSING;

    // Send close frame
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason, "utf-8"));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2, "utf-8");
    this._sendFrame(conn, OPCODE.CLOSE, payload);

    try {
      conn.socket.end();
    } catch {
      // silent
    }
    conn.readyState = WS_READY_STATE.CLOSED;
    this.connections.delete(conn.id);
  }
}
