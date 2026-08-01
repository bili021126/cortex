/**
 * @cortex/protocol — WebSocket 客户端命令
 */

import type { WSChannel } from "./channels.js";
import type { WSChatStartCommand, WSChatCancelCommand } from "./chat.js";
import type { WSGateResolveCommand } from "./gate.js";

/** 订阅命令 */
export interface WSSubscribeCommand {
  type: "subscribe";
  channels: WSChannel[];
}

/** 取消订阅命令 */
export interface WSUnsubscribeCommand {
  type: "unsubscribe";
  channels: WSChannel[];
}

/** 通知应答命令（S2-12）——客户端确认/驳回 urgent 通知 */
export interface WSNotificationAckCommand {
  type: "notification.ack";
  requestId: string;
  approved: boolean;
}

/** 客户端可发送的所有命令 */
export type WSClientCommand =
  | WSSubscribeCommand
  | WSUnsubscribeCommand
  | WSChatStartCommand
  | WSChatCancelCommand
  | WSGateResolveCommand
  | WSNotificationAckCommand;
