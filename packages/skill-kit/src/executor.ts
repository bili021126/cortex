/**
 * @cortex/skill-kit — 技能执行器
 *
 * 实现 SkillExecutor 接口，提供完整的执行管线：
 *   1. 参数校验（validateInput 或 inputSchema）
 *   2. 执行前钩子（onInit——仅首次执行时调用）
 *   3. 执行主逻辑（execute）
 *   4. 超时控制（AbortSignal + timeout）
 *   5. 执行元信息收集（duration, timestamp）
 *   6. 结果返回（成功/失败）
 *
 * @see docs/design.md §7 执行管线
 */

import {
  type SkillDefinition,
  type SkillContext,
  type SkillExecutor,
  type SkillOutput,
  type ExecutionMeta,
  type ExecuteOptions,
  type SkillLogger,
  SkillErrorCode,
} from "./types.js";

// ============================================================
// DefaultLogger — 默认控制台日志记录器
// ============================================================

/**
 * 默认控制台日志记录器。
 * 在无自定义 logger 时使用。
 */
const DEFAULT_LOGGER: SkillLogger = {
  info(msg: string, ...args: unknown[]): void {
    console.log(`[skill] ${msg}`, ...args);
  },
  warn(msg: string, ...args: unknown[]): void {
    console.warn(`[skill] ${msg}`, ...args);
  },
  error(msg: string, ...args: unknown[]): void {
    console.error(`[skill] ${msg}`, ...args);
  },
  debug(msg: string, ...args: unknown[]): void {
    console.debug(`[skill] ${msg}`, ...args);
  },
};

// ============================================================
// PipelineExecutor — 执行管线实现
// ============================================================

export interface PipelineExecutorOptions {
  /** 默认超时时间（毫秒），默认 30_000 */
  defaultTimeout?: number;
  /** 默认日志记录器 */
  logger?: SkillLogger;
  /** 是否在每次 execute 时重新执行 onInit，默认 false（仅首次） */
  reinitializeOnEachRun?: boolean;
}

/**
 * PipelineExecutor —— 技能执行管线实现。
 *
 * 执行管线：
 *   1. 设置超时控制（AbortController + setTimeout）
 *   2. 参数校验（validateInput 或 inputSchema）
 *   3. 执行前钩子（onInit——仅首次执行时调用）
 *   4. 构建执行上下文（含 AbortSignal）
 *   5. 执行主逻辑（execute）
 *   6. 超时检测——若信号已中止则返回 SKILL_TIMEOUT
 *   7. 收集执行元信息并返回结果
 */
export class PipelineExecutor implements SkillExecutor {
  private options: Required<PipelineExecutorOptions>;

  /** 跟踪已初始化过的技能 ID */
  private initializedSkills: Set<string> = new Set();

  constructor(options: PipelineExecutorOptions = {}) {
    this.options = {
      defaultTimeout: options.defaultTimeout ?? 30_000,
      logger: options.logger ?? DEFAULT_LOGGER,
      reinitializeOnEachRun: options.reinitializeOnEachRun ?? false,
    };
  }

  /**
   * 执行技能。
   *
   * @param skill   技能定义
   * @param input   技能输入参数
   * @param options 执行选项（超时、环境依赖等）
   * @returns 执行结果
   */
  async execute<TInput, TOutput>(
    skill: SkillDefinition<TInput, TOutput>,
    input: TInput,
    options?: ExecuteOptions,
  ): Promise<SkillOutput<TOutput>> {
    const startTime = Date.now();
    const logger = options?.logger ?? this.options.logger;

    // 合并执行选项
    const mergedOptions: Required<Pick<ExecuteOptions, "timeout" | "env" | "traceId">> & {
      logger: SkillLogger;
    } = {
      timeout: options?.timeout ?? this.options.defaultTimeout,
      env: options?.env ?? {},
      traceId: options?.traceId ?? `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      logger,
    };

    try {
      // ── 第 1 步：创建 AbortController + 超时控制 ──
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort(new Error(`技能执行超时 (${mergedOptions.timeout}ms)`));
      }, mergedOptions.timeout);

      try {
        // ── 第 2 步：参数校验 ──
        const validationError = await this.validateInput(skill, input);
        if (validationError) {
          return {
            success: false,
            error: validationError,
          };
        }

        // ── 第 3 步：onInit 钩子（仅首次或启用重新初始化） ──
        const skillId = skill.meta.id;
        const shouldInit =
          this.options.reinitializeOnEachRun || !this.initializedSkills.has(skillId);

        if (shouldInit && skill.onInit) {
          try {
            await skill.onInit({
              env: mergedOptions.env as Record<string, unknown>,
              logger,
            });
            this.initializedSkills.add(skillId);
          } catch (cause) {
            return {
              success: false,
              error: {
                code: SkillErrorCode.INIT_FAILED,
                message: `技能 "${skillId}" 初始化失败：${(cause as Error).message}`,
                details: undefined,
                cause: cause instanceof Error ? cause : undefined,
              },
            };
          }
        }

        // ── 第 4 步：构建执行上下文 ──
        const ctx: SkillContext<TInput, Record<string, unknown>> = {
          input,
          env: mergedOptions.env as Record<string, unknown>,
          signal: abortController.signal,
          logger,
          store: new Map<string, unknown>(),
          traceId: mergedOptions.traceId,
        };

        // ── 第 5 步：执行主逻辑 ──
        const result = await skill.execute(ctx as SkillContext<TInput>);

        // ── 第 6 步：超时检测 —— 若信号已被中止，返回 TIMEOUT ──
        if (abortController.signal.aborted) {
          const duration = Date.now() - startTime;
          return {
            success: false,
            error: {
              code: SkillErrorCode.TIMEOUT,
              message: `技能 "${skill.meta.id}" 执行超时 (${mergedOptions.timeout}ms)`,
              details: undefined,
              cause: abortController.signal.reason instanceof Error
                ? abortController.signal.reason
                : undefined,
            },
            meta: {
              duration,
              version: skill.meta.version,
              timestamp: startTime,
            },
          };
        }

        // ── 第 7 步：收集执行元信息 ──
        const duration = Date.now() - startTime;
        const meta: ExecutionMeta = {
          duration,
          version: skill.meta.version,
          timestamp: startTime,
        };

        // 如果 result 已经有 meta，合并；否则附加
        if (result.success) {
          return {
            success: true,
            data: result.data,
            meta: { ...meta, ...result.meta },
          };
        } else {
          return {
            success: false,
            error: result.error,
            meta: { ...meta, ...result.meta },
          };
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (cause) {
      // ── 未捕获异常 → 封装为 SKILL_EXECUTION_FAILED ──
      const duration = Date.now() - startTime;
      const errorMessage = cause instanceof Error ? cause.message : String(cause);

      logger.error(`技能 "${skill.meta.id}" 执行异常：${errorMessage}`);

      return {
        success: false,
        error: {
          code: SkillErrorCode.EXECUTION_FAILED,
          message: errorMessage,
          details: undefined,
          cause: cause instanceof Error ? cause : undefined,
        },
        meta: {
          duration,
          version: skill.meta.version,
          timestamp: startTime,
        },
      };
    }
  }

  /**
   * 重置初始化状态（使所有技能下次执行时重新执行 onInit）。
   */
  resetInitialization(): void {
    this.initializedSkills.clear();
  }

  /**
   * 标记指定技能的初始化状态已失效（下次执行时将重新 onInit）。
   */
  invalidateInitialization(skillId: string): void {
    this.initializedSkills.delete(skillId);
  }

  // ── 私有方法 ──────────────────────────────────────────────

  /**
   * 校验输入参数。
   * 优先使用技能自己的 validateInput 方法，
   * 其次尝试基于 inputSchema 的校验。
   */
  private async validateInput<TInput>(
    skill: SkillDefinition<TInput>,
    input: TInput,
  ): Promise<{
    code: SkillErrorCode;
    message: string;
    details?: unknown;
    cause?: Error;
  } | null> {
    // 优先使用 validateInput 类型守卫
    if (typeof skill.validateInput === "function") {
      if (!skill.validateInput(input)) {
        return {
          code: SkillErrorCode.VALIDATION_FAILED,
          message: `技能 "${skill.meta.id}" 输入参数校验失败（validateInput 返回 false）`,
          details: { input },
          cause: undefined,
        };
      }
      return null;
    }

    // 其次使用 inputSchema 做基础校验
    if (skill.meta.inputSchema) {
      const schemaErrors = this.validateAgainstSchema(input, skill.meta.inputSchema);
      if (schemaErrors.length > 0) {
        return {
          code: SkillErrorCode.VALIDATION_FAILED,
          message: `技能 "${skill.meta.id}" 输入参数不符合 inputSchema：${schemaErrors.join("; ")}`,
          details: { input, schemaErrors },
          cause: undefined,
        };
      }
    }

    return null;
  }

  /**
   * 基于 JSON Schema 进行基础校验。
   * 这是一个简化的校验实现，不依赖外部 JSON Schema 库。
   * 仅检查 type 和 required 字段。
   */
  private validateAgainstSchema(
    input: unknown,
    schema: Record<string, unknown>,
  ): string[] {
    const errors: string[] = [];

    // 检查 schema type
    if (schema.type === "object") {
      if (typeof input !== "object" || input === null) {
        errors.push(`期望 object，实际为 ${typeof input}`);
        return errors;
      }

      // 检查 required 字段
      const required = schema.required;
      if (Array.isArray(required)) {
        const obj = input as Record<string, unknown>;
        for (const field of required) {
          if (!(field in obj)) {
            errors.push(`缺少必填字段 "${field}"`);
          }
        }
      }
    }

    // 检查 schema type = array
    if (schema.type === "array") {
      if (!Array.isArray(input)) {
        errors.push(`期望 array，实际为 ${typeof input}`);
      }
    }

    // 检查 schema type = string / number / boolean
    if (typeof schema.type === "string" && !["object", "array"].includes(schema.type)) {
      if (typeof input !== schema.type) {
        errors.push(`期望 ${schema.type}，实际为 ${typeof input}`);
      }
    }

    return errors;
  }
}
