// ============================================================
// @cortex/notification/semantic-layer —— 通知语义分层
//
// 职责：
//   在物理通道（urgent/important/routine/info）之上添加语义层（FYI/WARNING/DECISION_REQUIRED），
//   让通知的语义意图与物理路由解耦。
//
// 设计原则：
//   1. 语义层是物理层的补充，不是替代——最终还是走 NotificationChannel
//   2. 语义标注帮助消费者理解"为什么收到这条通知"
//   3. DECISION_REQUIRED 自动映射到 urgent + ackRequired，确保用户响应
// ============================================================

import { NotificationChannel, type NotificationEvent } from "./types.js";

/**
 * 通知语义层级——描述通知的意图而非物理路由。
 */
export type NotificationSemantics = "FYI" | "WARNING" | "DECISION_REQUIRED";

/**
 * 语义增强事件——在 NotificationEvent 上附加语义标注。
 */
export interface SemanticNotification extends NotificationEvent {
  /** 语义层级 */
  semantics: NotificationSemantics;
  /** 语义描述——人类可读的意图说明 */
  semanticsDescription: string;
}

/**
 * 语义到物理通道的默认映射。
 */
export const SEMANTIC_TO_CHANNEL: Record<NotificationSemantics, NotificationChannel> = {
  FYI: NotificationChannel.Routine,
  WARNING: NotificationChannel.Important,
  DECISION_REQUIRED: NotificationChannel.Urgent,
};

/**
 * 语义描述模板。
 */
export const SEMANTIC_DESCRIPTIONS: Record<NotificationSemantics, string> = {
  FYI: "仅供参考——无需行动",
  WARNING: "警告——需要关注但不紧急",
  DECISION_REQUIRED: "需要决策——请确认或批准",
};

/**
 * 语义增强函数——为通知事件添加语义标注。
 *
 * @param event 原始通知事件
 * @param semantics 语义层级
 * @returns 语义增强后的通知
 */
export function withSemantics(
  event: NotificationEvent,
  semantics: NotificationSemantics,
): SemanticNotification {
  return {
    ...event,
    semantics,
    semanticsDescription: SEMANTIC_DESCRIPTIONS[semantics],
  };
}

/**
 * 语义路由建议——根据语义层级建议物理通道和 ack 设置。
 *
 * @param semantics 语义层级
 * @returns 建议的 channel 和 ackRequired
 */
export function suggestRouting(semantics: NotificationSemantics): {
  channel: NotificationChannel;
  ackRequired: boolean;
} {
  return {
    channel: SEMANTIC_TO_CHANNEL[semantics],
    ackRequired: semantics === "DECISION_REQUIRED",
  };
}
