/**
 * @cortex/protocol — WebSocket 通道定义
 */

/** 所有可用的 WebSocket 通道 */
export type WSChannel =
  | "state"
  | "pipeline"
  | "tui"
  | "system"
  | "config"
  | "chat"
  | "gate"
  | "agent"
  | "memory"
  | "session"
  | "notification";

/** WebSocket 消息包装 */
export interface WSMessage<T = unknown> {
  channel: WSChannel;
  data: T;
}
