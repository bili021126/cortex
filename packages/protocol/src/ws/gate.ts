/**
 * @cortex/protocol — Gate WebSocket 协议
 *
 * 定义 ConfirmGate 远程确认的通信类型。
 * 服务端在需要人工确认时推送 gate.request，客户端回复 gate.resolve。
 */

// ─── 服务端 → 客户端事件 ─────────────────────────────────

/** 确认请求事件 */
export interface WSGateRequestEvent {
  channel: "gate";
  data: {
    type: "gate.request";
    requestId: string;
    sessionId: string;
    toolName: string;
    level: string;
    summary: string;
    detail?: string;
  };
}

/** 通知事件（非阻塞） */
export interface WSGateNotifyEvent {
  channel: "gate";
  data: {
    type: "gate.notify";
    message: string;
  };
}

/** 所有 gate 服务端事件的联合 */
export type WSGateServerEvent = WSGateRequestEvent | WSGateNotifyEvent;

// ─── 客户端 → 服务端命令 ─────────────────────────────────

/** 确认响应命令 */
export interface WSGateResolveCommand {
  type: "gate.resolve";
  requestId: string;
  approved: boolean;
}
