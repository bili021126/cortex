/**
 * @cortex/skill-kit — SkillFactory 统一入口工厂
 *
 * 组合 Loader + Validator + Executor + Cache 四件套，
 * 对外提供简洁的 API。
 *
 * 典型用法：
 * ```typescript
 * const factory = new SkillFactory({
 *   loader: new DynamicImportLoader(),
 *   cache: new DefaultSkillCache({ maxSize: 100, ttl: 60_000 }),
 * });
 *
 * // 加载并执行技能
 * const result = await factory.execute('skill-p10-ci-gate', {
 *   branch: 'feature/xxx',
 * });
 * ```
 *
 * @see docs/design.md §4.5 SkillFactory
 */

import {
  type SkillDefinition,
  type SkillOutput,
  type ValidationResult,
  type ExecuteOptions,
  type SkillLoader,
  type SkillValidator,
  type SkillExecutor,
  type SkillCache,
  type SkillLogger,
  SkillErrorCode,
} from "./types.js";
import { SimpleSkillValidator } from "./validator.js";
import { PipelineExecutor } from "./executor.js";
import { DefaultSkillCache } from "./cache.js";

// ============================================================
// SkillFactory 配置选项
// ============================================================

export interface SkillFactoryOptions {
  loader: SkillLoader;
  validator?: SkillValidator;
  executor?: SkillExecutor;
  cache?: SkillCache;
  /** 默认超时时间（毫秒） */
  defaultTimeout?: number;
  /** 默认日志记录器 */
  logger?: SkillLogger;
}

// ============================================================
// SkillFactory — 统一入口工厂
// ============================================================

/**
 * SkillFactory —— 技能系统的统一入口。
 *
 * 组合 Loader + Validator + Executor + Cache 四件套，
 * 对外提供简洁的 API。
 *
 * 生命周期：
 * ```
 * factory.execute('skill-id', input)
 *   ├─ 1. cache.get('skill-id')          ← 查缓存
 *   ├─ 2. loader.load('skill-id')        ← 缓存未命中时加载
 *   ├─ 3. cache.set('skill-id', skill)   ← 写入缓存
 *   ├─ 4. validator.validate(skill)      ← 校验完整性
 *   ├─ 5. executor.execute(skill, input) ← 执行
 *   └─ 6. 返回结果
 * ```
 */
export class SkillFactory {
  private loader: SkillLoader;
  private validator: SkillValidator;
  private executor: SkillExecutor;
  private cache: SkillCache;
  private defaultTimeout: number;
  private logger: SkillLogger;

  constructor(options: SkillFactoryOptions) {
    this.loader = options.loader;
    this.validator = options.validator ?? new SimpleSkillValidator();
    this.executor = options.executor ?? new PipelineExecutor({
      defaultTimeout: options.defaultTimeout,
      logger: options.logger,
    });
    this.cache = options.cache ?? new DefaultSkillCache();
    this.defaultTimeout = options.defaultTimeout ?? 30_000;
    this.logger = options.logger ?? {
      info: (...args: unknown[]) => console.log("[skill-kit]", ...args),
      warn: (...args: unknown[]) => console.warn("[skill-kit]", ...args),
      error: (...args: unknown[]) => console.error("[skill-kit]", ...args),
      debug: (...args: unknown[]) => console.debug("[skill-kit]", ...args),
    };
  }

  /**
   * 加载技能（优先查缓存，未命中则调用 loader.load）。
   */
  async load(skillId: string): Promise<SkillDefinition> {
    // 优先查缓存
    const cached = this.cache.get(skillId);
    if (cached) {
      this.logger.debug(`缓存命中：${skillId}`);
      return cached;
    }

    // 缓存未命中，重新加载
    this.logger.debug(`缓存未命中，加载技能：${skillId}`);
    const skill = await this.loader.load(skillId);

    // 写入缓存
    this.cache.set(skillId, skill);

    return skill;
  }

  /**
   * 执行技能（load + validate + execute 一站式）。
   */
  async execute<TInput, TOutput>(
    skillId: string,
    input: TInput,
    options?: ExecuteOptions,
  ): Promise<SkillOutput<TOutput>> {
    const mergedOptions: ExecuteOptions = {
      timeout: options?.timeout ?? this.defaultTimeout,
      logger: options?.logger ?? this.logger,
      env: options?.env,
      traceId: options?.traceId,
    };

    // 1. 加载技能
    let skill: SkillDefinition;
    try {
      skill = await this.load(skillId);
    } catch (cause) {
      return {
        success: false,
        error: {
          code: SkillErrorCode.NOT_FOUND,
          message: `加载技能 "${skillId}" 失败：${(cause as Error).message}`,
          details: undefined,
          cause: cause instanceof Error ? cause : undefined,
        },
      };
    }

    // 2. 校验技能完整性
    const validationResult = this.validator.validate(skill);
    if (!validationResult.valid) {
      return {
        success: false,
        error: {
          code: SkillErrorCode.VALIDATION_FAILED,
          message: `技能 "${skillId}" 校验失败：${validationResult.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
          details: validationResult.errors,
        },
      };
    }

    // 3. 执行技能
    return this.executor.execute(skill, input, mergedOptions) as Promise<SkillOutput<TOutput>>;
  }

  /**
   * 校验技能。
   */
  async validate(skillId: string): Promise<ValidationResult> {
    try {
      const skill = await this.load(skillId);
      return this.validator.validate(skill);
    } catch (cause) {
      return {
        valid: false,
        errors: [
          {
            path: "(root)",
            message: `加载技能 "${skillId}" 失败：${(cause as Error).message}`,
            severity: "error",
          },
        ],
        warnings: [],
      };
    }
  }

  /**
   * 获取加载器引用。
   */
  getLoader(): SkillLoader {
    return this.loader;
  }

  /**
   * 获取缓存引用。
   */
  getCache(): SkillCache {
    return this.cache;
  }

  /**
   * 注册技能入口路径（快捷方法）。
   */
  register(skillId: string, filePath: string): void {
    this.loader.register(skillId, filePath);
  }

  /**
   * 批量注册技能入口（快捷方法）。
   */
  registerMany(entries: Array<{ id: string; path: string }>): void {
    this.loader.registerMany(entries);
  }

  /**
   * 释放资源（销毁所有缓存的技能实例）。
   */
  async dispose(): Promise<void> {
    this.cache.clear();
  }
}
