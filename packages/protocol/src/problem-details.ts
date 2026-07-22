/**
 * @cortex/protocol — RFC 7807 Problem Details
 *
 * 统一错误响应格式。所有 API 错误（4xx/5xx）均返回此结构。
 * Content-Type: application/problem+json
 */

/** RFC 7807 问题详情 */
export interface ProblemDetails {
  /** 错误类型 URI（如 "https://cortex.dev/errors/not-found"） */
  type: string;
  /** 人类可读的简短标题 */
  title: string;
  /** HTTP 状态码 */
  status: number;
  /** 详细描述 */
  detail?: string;
  /** 请求实例标识（X-Request-Id） */
  instance?: string;
  /** 字段级校验错误列表（422 时使用） */
  errors?: Array<{ field: string; message: string }>;
}

// ─── 标准错误类型 URI ─────────────────────────────────

export const ERROR_BASE = "https://cortex.dev/errors";

export const ErrorType = {
  BadRequest: `${ERROR_BASE}/bad-request`,
  NotFound: `${ERROR_BASE}/not-found`,
  MethodNotAllowed: `${ERROR_BASE}/method-not-allowed`,
  Validation: `${ERROR_BASE}/validation`,
  PayloadTooLarge: `${ERROR_BASE}/payload-too-large`,
  Internal: `${ERROR_BASE}/internal`,
} as const;

/** 快速构造 ProblemDetails */
export function problem(
  status: number,
  title: string,
  detail?: string,
  instance?: string,
  errors?: Array<{ field: string; message: string }>,
): ProblemDetails {
  const typeMap: Record<number, string> = {
    400: ErrorType.BadRequest,
    404: ErrorType.NotFound,
    405: ErrorType.MethodNotAllowed,
    413: ErrorType.PayloadTooLarge,
    422: ErrorType.Validation,
    500: ErrorType.Internal,
  };
  return {
    type: typeMap[status] ?? ErrorType.Internal,
    title,
    status,
    detail,
    instance,
    errors,
  };
}
