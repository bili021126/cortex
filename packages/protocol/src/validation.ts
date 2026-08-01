/**
 * @cortex/protocol — 轻量运行时类型守卫
 *
 * 零依赖的结构性校验——仅检查关键字段存在性和类型。
 * 不做深度校验（那是各端自己的事）。
 */

import type { ProtocolEnvelope } from "./envelope.js";
import type { ProblemDetails } from "./problem-details.js";
import type { WSClientCommand } from "./ws/commands.js";
import type { WSMessage } from "./ws/channels.js";

/** 检查是否为合法的消息信封 */
export function isProtocolEnvelope(v: unknown): v is ProtocolEnvelope {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.type === "string" &&
    typeof o.timestamp === "number" &&
    typeof o.version === "string" &&
    "payload" in o
  );
}

/** 检查是否为 RFC 7807 ProblemDetails */
export function isProblemDetails(v: unknown): v is ProblemDetails {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.type === "string" &&
    typeof o.title === "string" &&
    typeof o.status === "number"
  );
}

/**
 * 检查是否为合法的 WebSocket 客户端命令。
 *
 * 与 WSClientCommand 联合（6 成员）结构性对齐：
 *   subscribe / unsubscribe —— channels: string[]
 *   chat.start —— sessionId/input/mode/agent + 可选 history
 *   chat.cancel —— sessionId
 *   gate.resolve / notification.ack —— requestId + approved
 * 仅检查关键字段存在性与类型，不做深度校验。
 */
export function isWSClientCommand(v: unknown): v is WSClientCommand {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;

  switch (o.type) {
    case "subscribe":
    case "unsubscribe":
      if (!Array.isArray(o.channels)) return false;
      return (o.channels as unknown[]).every((c) => typeof c === "string");
    case "notification.ack":
      return typeof o.requestId === "string" && typeof o.approved === "boolean";
    case "chat.start":
      return (
        typeof o.sessionId === "string" &&
        typeof o.input === "string" &&
        typeof o.mode === "string" &&
        typeof o.agent === "string" &&
        (o.history === undefined || Array.isArray(o.history))
      );
    case "chat.cancel":
      return typeof o.sessionId === "string";
    case "gate.resolve":
      return typeof o.requestId === "string" && typeof o.approved === "boolean";
    default:
      return false;
  }
}

/** 检查是否为合法的 WebSocket 消息 */
export function isWSMessage(v: unknown): v is WSMessage {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.channel === "string" && "data" in o;
}
