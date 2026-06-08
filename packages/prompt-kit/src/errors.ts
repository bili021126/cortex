/**
 * @cortex/prompt-kit — 自定义错误类型
 */

import { PromptErrorCode } from "./types.js";

/**
 * Prompt 错误基类。
 * 所有 prompt-kit 错误均继承此类，支持 code + message + details 三元组。
 */
export class PromptError extends Error {
  /**
   * @param message   人类可读的错误描述
   * @param code      错误码枚举
   * @param details   可选的附加错误数据（上下文、来源、原始异常等）
   */
  constructor(
    message: string,
    public readonly code: PromptErrorCode,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "PromptError";
  }
}

/**
 * 加载失败错误。
 */
export class PromptLoadError extends PromptError {
  constructor(
    message: string,
    public override readonly details?: { source?: string; cause?: Error },
  ) {
    super(message, PromptErrorCode.LOAD_FAILED, details);
    this.name = "PromptLoadError";
  }
}

/**
 * 校验失败错误。
 */
export class PromptValidationError extends PromptError {
  constructor(
    message: string,
    public override readonly details?: { errors: unknown[] },
  ) {
    super(message, PromptErrorCode.VALIDATION_FAILED, details);
    this.name = "PromptValidationError";
  }
}

/**
 * 渲染失败错误。
 */
export class PromptRenderError extends PromptError {
  constructor(
    message: string,
    public override readonly details?: { blockId?: string; cause?: Error },
  ) {
    super(message, PromptErrorCode.RENDER_FAILED, details);
    this.name = "PromptRenderError";
  }
}
