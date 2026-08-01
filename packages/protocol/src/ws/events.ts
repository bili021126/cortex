/**
 * @cortex/protocol — WebSocket 服务端事件目录
 *
 * 三端（CLI / WebUI / Desktop）消费的统一事件 schema。
 * 所有 server→client 推送均为此文件中的某个类型。
 */

import type { WebUIState } from "../rest/state.js";
import type { EventRecord } from "../rest/events.js";
import type { SessionDTO } from "../rest/sessions.js";
import type { MemoryEntryDTO } from "../rest/memory.js";
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

// ─── tui channel ────────────────────────────────────────────
// @planned 预留通道——server 尚未发射，待 TUI 远程渲染接入后启用。

/** TUI 事件（任务树更新、节点状态变化等） */
export interface WSTuiEvent {
  channel: "tui";
  data: {
    type: string;
    [key: string]: unknown;
  };
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

// ─── agent channel ──────────────────────────────────────────
// @planned multi-agent 预留事件——server 尚未发射，待多 Agent 协作接入后启用。

/** Agent 状态变更 */
export interface WSAgentStatusEvent {
  channel: "agent";
  data: {
    type: "agent.status_change";
    agentType: string;
    instanceId: string;
    status: "idle" | "thinking" | "executing" | "waiting_gate" | "error";
    previousStatus: string;
    timestamp: number;
  };
}

/** Agent 被分配任务 */
export interface WSAgentTaskAssignedEvent {
  channel: "agent";
  data: {
    type: "agent.task_assigned";
    agentType: string;
    instanceId: string;
    nodeId: string;
    taskDescription: string;
    timestamp: number;
  };
}

/** Agent 完成任务 */
export interface WSAgentTaskCompleteEvent {
  channel: "agent";
  data: {
    type: "agent.task_complete";
    agentType: string;
    instanceId: string;
    nodeId: string;
    success: boolean;
    durationMs: number;
    timestamp: number;
  };
}

/** Agent channel 事件联合 */
export type WSAgentServerEvent =
  | WSAgentStatusEvent
  | WSAgentTaskAssignedEvent
  | WSAgentTaskCompleteEvent;

// ─── memory channel ─────────────────────────────────────────
// @planned 预留事件——server 尚未发射，待记忆写入推送接入后启用。

/** 记忆写入通知 */
export interface WSMemoryWrittenEvent {
  channel: "memory";
  data: {
    type: "memory.written";
    entry: MemoryEntryDTO;
    timestamp: number;
  };
}

/** 记忆更新通知 */
export interface WSMemoryUpdatedEvent {
  channel: "memory";
  data: {
    type: "memory.updated";
    entry: MemoryEntryDTO;
    previousSummary: string;
    timestamp: number;
  };
}

/** 记忆删除通知 */
export interface WSMemoryDeletedEvent {
  channel: "memory";
  data: {
    type: "memory.deleted";
    entryId: string;
    kind: string;
    timestamp: number;
  };
}

/** Memory channel 事件联合 */
export type WSMemoryServerEvent =
  | WSMemoryWrittenEvent
  | WSMemoryUpdatedEvent
  | WSMemoryDeletedEvent;

// ─── session channel ────────────────────────────────────────
// @planned 预留事件——server 尚未发射，待会话生命周期推送接入后启用。

/** 会话创建 */
export interface WSSessionCreatedEvent {
  channel: "session";
  data: {
    type: "session.created";
    session: SessionDTO;
  };
}

/** 会话结束（正常完成或超时 GC） */
export interface WSSessionEndedEvent {
  channel: "session";
  data: {
    type: "session.ended";
    sessionId: string;
    reason: "completed" | "cancelled" | "timeout" | "daemon_shutdown";
    timestamp: number;
  };
}

/** 会话恢复（客户端重连后恢复已有会话） */
export interface WSSessionResumedEvent {
  channel: "session";
  data: {
    type: "session.resumed";
    session: SessionDTO;
  };
}

/** Session channel 事件联合 */
export type WSSessionServerEvent =
  | WSSessionCreatedEvent
  | WSSessionEndedEvent
  | WSSessionResumedEvent;

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
  // state
  | WSStateEvent
  // pipeline
  | WSPipelineEvent
  // tui
  | WSTuiEvent
  // config
  | WSConfigEvent
  // chat (5 events)
  | WSChatServerEvent
  // gate (2 events)
  | WSGateServerEvent
  // agent (3 events)
  | WSAgentServerEvent
  // memory (3 events)
  | WSMemoryServerEvent
  // session (3 events)
  | WSSessionServerEvent
  // notification (2 events)
  | WSNotificationServerEvent;

/** 按 channel 提取事件子集 */
export type WSServerEventByChannel<C extends WSServerEvent["channel"]> =
  Extract<WSServerEvent, { channel: C }>;
