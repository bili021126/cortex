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

/** 检查是否为合法的 WebSocket 客户端命令 */
export function isWSClientCommand(v: unknown): v is WSClientCommand {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.type !== "subscribe" && o.type !== "unsubscribe") return false;
  if (!Array.isArray(o.channels)) return false;
  return (o.channels as unknown[]).every((c) => typeof c === "string");
}

/** 检查是否为合法的 WebSocket 消息 */
export function isWSMessage(v: unknown): v is WSMessage {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.channel === "string" && "data" in o;
}
