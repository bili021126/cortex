/**
 * @cortex/protocol — WebSocket 服务端事件目录
 *
 * 三端（CLI / WebUI / Desktop）消费的统一事件 schema。
 * 所有 server→client 推送均为此文件中的某个类型。
 */

import type { WebUIState } from "../rest/state.js";
import type { EventRecord } from "../rest/events.js";
import type { WSChatServerEvent } from "./chat.js";
import type { WSGateServerEvent } from "./gate.js";

// ─── system channel ─────────────────────────────────────────

/** 订阅确认事件 */
export interface WSSubscriptionAck {
  channel: "system";
  data: {
    type: "subscription_ack";
    channels: string[];
  };
}

/** Daemon 状态快照（启动后首次推送 + 定期心跳） */
export interface WSDaemonStatusEvent {
  channel: "system";
  data: {
    type: "system.status";
    pid: number;
    uptimeMs: number;
    version: string;
    engineReady: boolean;
    activeSessions: number;
    chatModel: string;
    reasonerModel: string;
    contextWindowUsed: number; // 0-1
  };
}

/** 系统关闭通知 */
export interface WSSystemShutdownEvent {
  channel: "system";
  data: {
    type: "system.shutdown";
    reason?: string;
  };
}

/** 系统错误通知（命令校验失败等——A2 入站校验错误帧） */
export interface WSSystemErrorEvent {
  channel: "system";
  data: {
    type: "system.error";
    message: string;
    reason?: string;
  };
}

// ─── state channel ──────────────────────────────────────────

/** 状态快照事件（每 500ms 或事件驱动推送） */
export interface WSStateEvent {
  channel: "state";
  data: WebUIState;
}

// ─── pipeline channel ───────────────────────────────────────

/** 管线事件（引擎 ObservableEvent 透传） */
export interface WSPipelineEvent {
  channel: "pipeline";
  data: EventRecord;
}

// ─── config channel ─────────────────────────────────────────

/** 配置变更事件 */
export interface WSConfigEvent {
  channel: "config";
  data: {
    type: "config.changed";
    domain: string;
    key?: string;
    timestamp: number;
  };
}

// ─── notification channel ──────────────────────────────────

/**
 * 通知事件（S2-11）——Urgent/Important 通道通知经 WS 推送。
 * ackRequired=true 时客户端应以 notification.ack 命令应答。
 */
export interface WSNotificationEvent {
  channel: "notification";
  data: {
    type: "notification.pushed";
    requestId: string;
    eventType: string;
    channel: "urgent" | "important" | "routine" | "info";
    summary: string;
    detail?: string;
    sourceAgent?: string;
    ackRequired: boolean;
    timestamp: number;
  };
}

/** ack 结果回执（notification.ack 命令的应答） */
export interface WSNotificationAckedEvent {
  channel: "notification";
  data: {
    type: "notification.acked";
    requestId: string;
    acked: boolean;
  };
}

/** Notification channel 事件联合 */
export type WSNotificationServerEvent =
  | WSNotificationEvent
  | WSNotificationAckedEvent;

// ─── 总联合 ─────────────────────────────────────────────────

/** 所有服务端事件的联合类型——三端渲染的唯一类型锚点 */
export type WSServerEvent =
  // system
  | WSSubscriptionAck
  | WSDaemonStatusEvent
  | WSSystemShutdownEvent
  | WSSystemErrorEvent
  // state
  | WSStateEvent
  // pipeline
  | WSPipelineEvent
  // config
  | WSConfigEvent
  // chat (5 events)
  | WSChatServerEvent
  // gate (2 events)
  | WSGateServerEvent
  // notification (2 events)
  | WSNotificationServerEvent;

/** 按 channel 提取事件子集 */
export type WSServerEventByChannel<C extends WSServerEvent["channel"]> =
  Extract<WSServerEvent, { channel: C }>;
