/**
 * @cortex/client — 错误类型
 */

import type { ProblemDetails } from "@cortex/protocol";

/** API 返回 ProblemDetails 时抛出 */
export class ProtocolError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = "ProtocolError";
  }

  get status(): number {
    return this.problem.status;
  }
}

/** 连接层错误（网络不可达、WebSocket 断开等） */
export class ConnectionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ConnectionError";
  }
}
