/**
 * @cortex/server — 通知 → WS 桥接（S2-11/S2-12）
 *
 * 将 NotificationPipe 的 Urgent/Important 通道事件转换为 WS 广播，
 * 并处理客户端 notification.ack 应答回路。
 * 独立模块以便守护测试直接验证接线（daemon.start() 依赖真实 engine，不可单测）。
 */

import { NotificationChannel, type NotificationEvent, type NotificationPipe } from "@cortex/notification";
import type { WSNotificationAckedEvent, WSNotificationEvent } from "@cortex/protocol";

/** WS 广播函数签名（与 WSGateway.broadcast 兼容） */
export type BroadcastFn = (channel: string, data: unknown) => void;

/** 将通知事件转换为 WS notification.pushed 负载 */
export function toNotificationPushedData(event: NotificationEvent): WSNotificationEvent["data"] {
  return {
    type: "notification.pushed",
    requestId: event.requestId,
    eventType: event.type,
    channel: event.channel,
    summary: event.summary,
    detail: event.detail,
    sourceAgent: event.sourceAgent,
    ackRequired: event.ackRequired,
    timestamp: event.timestamp,
  };
}

/**
 * 订阅 NotificationPipe 的 Urgent/Important 通道，推送至 WS。
 * @returns 解除订阅函数（daemon.stop 时调用，防 handler 累积泄漏）
 */
export function bridgeNotifications(pipe: NotificationPipe, broadcast: BroadcastFn): () => void {
  const handler = (event: NotificationEvent): void => {
    broadcast("notification", toNotificationPushedData(event));
  };
  pipe.on(NotificationChannel.Urgent, handler);
  pipe.on(NotificationChannel.Important, handler);
  return () => {
    pipe.off(NotificationChannel.Urgent, handler);
    pipe.off(NotificationChannel.Important, handler);
  };
}

/**
 * 处理客户端 notification.ack 命令——应答 urgent 通知并回执结果。
 * @returns 是否处理成功（ack 是否生效）
 */
export function handleNotificationAck(
  pipe: NotificationPipe | undefined,
  requestId: string,
  approved: boolean,
): WSNotificationAckedEvent["data"] {
  const acked = pipe?.ack(requestId, approved) ?? false;
  return { type: "notification.acked", requestId, acked };
}
