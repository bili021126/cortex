/**
 * PresenceBridge — WS 事件 → Presence IPC 转发
 *
 * 订阅 daemon 的 chat / gate / system 三个 channel，
 * 将 WSServerEvent 精简为 PresenceEvent 载荷，
 * 通过 IPC 推送到桌宠渲染进程驱动 PresenceEngine。
 *
 * 架构：
 *   daemon WS → CortexWSClient → PresenceBridge → IPC → renderer PresenceEngine
 *
 * @since v7 — Presence 层接入
 */
import type { BrowserWindow } from "electron";
import type { CortexConnection } from "@cortex/client";

// ── IPC 通道名 ────────────────────────────────────────
export const PRESENCE_IPC_CHANNEL = "presence:event";

/** Presence 层订阅的 channel（只需三个，不是全部） */
const PRESENCE_CHANNELS: ("chat" | "gate" | "system")[] = ["chat", "gate", "system"];

/** 精简后的事件载荷（与 renderer/presence/emotion-map PresenceEvent 对齐） */
export interface PresenceEventPayload {
  type: string;
  chunkLength?: number;
  success?: boolean;
  toolName?: string;
}

export class PresenceBridge {
  private unsubs: (() => void)[] = [];
  private started = false;

  constructor(
    private readonly win: BrowserWindow,
    private readonly conn: CortexConnection,
  ) {}

  /** 开始订阅 + 转发。应在 mainWindow 创建后、daemon 连通后调用。 */
  start(): void {
    if (this.started) return;
    this.started = true;

    // 向 server 发送 subscribe 命令
    this.conn.ws.subscribe(PRESENCE_CHANNELS);

    // 注册 channel 监听
    this.unsubs.push(
      this.conn.ws.on("chat", (msg) => this.onChat(msg.data as Record<string, unknown>)),
      this.conn.ws.on("gate", (msg) => this.onGate(msg.data as Record<string, unknown>)),
      this.conn.ws.on("system", (msg) => this.onSystem(msg.data as Record<string, unknown>)),
    );
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.started = false;
  }

  // ── 事件转换 ────────────────────────────────────────

  private send(event: PresenceEventPayload): void {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(PRESENCE_IPC_CHANNEL, event);
    }
  }

  private onChat(data: Record<string, unknown>): void {
    switch (data.type) {
      case "chat.chunk":
        this.send({ type: "chat.chunk", chunkLength: ((data.content as string) ?? "").length || 1 });
        break;
      case "chat.tool_start":
        this.send({ type: "chat.tool_start", toolName: data.toolName as string });
        break;
      case "chat.tool_result":
        this.send({ type: "chat.tool_result", success: data.success as boolean, toolName: data.toolName as string });
        break;
      case "chat.complete":
        this.send({ type: "chat.complete" });
        break;
      case "chat.error":
        this.send({ type: "chat.error" });
        break;
    }
  }

  private onGate(data: Record<string, unknown>): void {
    if (data.type === "gate.request") this.send({ type: "gate.request" });
    else if (data.type === "gate.notify") this.send({ type: "gate.notify" });
  }

  private onSystem(data: Record<string, unknown>): void {
    if (data.type === "system.status") this.send({ type: "system.status" });
    else if (data.type === "system.shutdown") this.send({ type: "system.shutdown" });
  }
}
