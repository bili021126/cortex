/**
 * @cortex/protocol — 消息信封
 *
 * 所有 REST 响应和 WebSocket 推送的统一外层包装。
 * 客户端可以依赖 envelope 结构做通用日志、追踪、版本协商。
 */

/** 协议消息信封——所有通信的统一包装 */
export interface ProtocolEnvelope<T = unknown> {
  /** 消息唯一标识（UUID v4） */
  id: string;
  /** 消息类型标识（如 "state.snapshot", "config.model.created"） */
  type: string;
  /** Unix 毫秒时间戳 */
  timestamp: number;
  /** 协议版本（语义化） */
  version: string;
  /** 载荷 */
  payload: T;
}

/** 创建一个标准信封 */
export function createEnvelope<T>(type: string, payload: T, version = "1.0.0"): ProtocolEnvelope<T> {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: Date.now(),
    version,
    payload,
  };
}
