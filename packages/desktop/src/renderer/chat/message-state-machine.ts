/**
 * U1 消息状态机——纯 reducer（desktop 首选——UX 调研稿 §1）
 *
 * 十态：idle/queued/sending/streaming/complete/stopped/interrupted/
 *       error_timeout/error_fatal/regenerating
 *
 * 设计决策（来自调研稿）：
 * 1. stopped（用户意图——保留已生成可 regenerate）≠ interrupted（网络故障——retry 续传）
 * 2. error 分三类：timeout（可重试）/ fatal（不可——认证/模型消失）/ interrupted（网络——续传）
 * 3. regenerating 保留原内容灰显（对比式——不直接覆盖）
 *
 * 纯函数——无副作用——转换表每边可测。
 */

export type MessageState =
  | "idle"
  | "queued"
  | "sending"
  | "streaming"
  | "complete"
  | "stopped"
  | "interrupted"
  | "error_timeout"
  | "error_fatal"
  | "regenerating";

export type MessageEvent =
  | { type: "submit" }
  | { type: "ack" }
  | { type: "first-token" }
  | { type: "complete" }
  | { type: "stop" }
  | { type: "net-error" }
  | { type: "timeout" }
  | { type: "fatal" }
  | { type: "regenerate" }
  | { type: "retry" }
  | { type: "edit-and-resubmit" }
  | { type: "reset" };

/** 非法转换的错误类型（TDD：转换表每边一个用例的断言依据） */
export class InvalidTransitionError extends Error {
  constructor(from: MessageState, event: string) {
    super(`U1 非法转换: ${from} --${event}--> ?`);
    this.name = "InvalidTransitionError";
  }
}

/** 转换表——唯一真相源（十态全边） */
const TRANSITIONS: Record<MessageState, Partial<Record<MessageEvent["type"], MessageState>>> = {
  idle: { submit: "queued" },
  queued: { ack: "sending", stop: "idle" },
  sending: { "first-token": "streaming", stop: "stopped", "net-error": "interrupted", timeout: "error_timeout", fatal: "error_fatal" },
  streaming: { complete: "complete", stop: "stopped", "net-error": "interrupted", timeout: "error_timeout", fatal: "error_fatal" },
  complete: { "edit-and-resubmit": "queued", regenerate: "regenerating" },
  stopped: { regenerate: "regenerating", "edit-and-resubmit": "queued" },
  interrupted: { retry: "queued", "edit-and-resubmit": "queued" },
  error_timeout: { retry: "queued", "edit-and-resubmit": "queued" },
  error_fatal: { "edit-and-resubmit": "queued" },
  regenerating: { "first-token": "streaming", stop: "stopped" },
};

/**
 * reducer——纯函数：state + event → nextState
 * 非法转换抛 InvalidTransitionError（调用方捕获后按 UI 策略处理）
 */
export function messageReducer(state: MessageState, event: MessageEvent): MessageState {
  if (event.type === "reset") return "idle";
  const next = TRANSITIONS[state]?.[event.type];
  if (!next) throw new InvalidTransitionError(state, event.type);
  return next;
}

/** 可重试状态（UI 的 retry 按钮可见性） */
export function isRetryable(state: MessageState): boolean {
  return state === "interrupted" || state === "error_timeout";
}

/** 可停止状态（stop 按钮可见性） */
export function isStoppable(state: MessageState): boolean {
  return state === "queued" || state === "sending" || state === "streaming" || state === "regenerating";
}

/** 已生成内容保留状态（气泡不灰显的语义） */
export function hasContent(state: MessageState): boolean {
  return state === "streaming" || state === "complete" || state === "stopped" || state === "interrupted" || state === "regenerating";
}

/** UI 规格（调研稿 §1.3）——状态 → 气泡/按钮/辅助 */
export const UI_SPEC: Record<MessageState, { bubble: string; primaryAction?: string; note: string }> = {
  idle: { bubble: "占位", note: "" },
  queued: { bubble: "灰底 + 等待中", primaryAction: "取消", note: "" },
  sending: { bubble: "骨架闪烁", primaryAction: "取消", note: "耗时 >5s 才显示" },
  streaming: { bubble: "光标逐字 + thinking 折叠", primaryAction: "stop", note: "token 计数（低调）" },
  complete: { bubble: "正常", primaryAction: "regenerate", note: "耗时 + 模型标签" },
  stopped: { bubble: "正常 + 已停止角标", primaryAction: "regenerate", note: "保留已生成内容" },
  interrupted: { bubble: "半透明 + 连接中断", primaryAction: "retry", note: "不丢已生成部分" },
  error_timeout: { bubble: "红色边框 + 超时", primaryAction: "retry", note: "显示耗时" },
  error_fatal: { bubble: "红色 + 具体原因", note: "原因文案（认证失败等）" },
  regenerating: { bubble: "原内容灰显", primaryAction: "stop", note: "对比式（不直接覆盖）" },
};
