// ============================================================================
// @cortex/skill-kit — Executor
//
// Orchestrator that coordinates Loader, Validator, Cache, and SkillExecutor
// to provide the full skill lifecycle: load → validate → cache → execute.
// ============================================================================

import type {
  SkillDefinition,
  SkillExecutor,
  ExecutionContext,
  ExecutionResult,
  ExecutorEvent,
  ExecutorEventListener,
  ExecutorOptions,
  LoadResult,
  ValidationResult,
} from './types.js';
import { Loader } from './loader.js';
import { Validator } from './validator.js';
import { Cache } from './cache.js';

// ─── DefaultSkillExecutor ──────────────────────────────────────────────────

/**
 * 默认 SkillExecutor 实现。
 * 包装 SkillDefinition 为 SkillExecutor 接口。
 */
class DefaultSkillExecutor implements SkillExecutor {
  readonly skillId: string;

  constructor(private readonly skill: SkillDefinition) {
    this.skillId = skill.id;
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const logs: string[] = [];
    const start = performance.now();

    try {
      logs.push(`[${this.skillId}] Executing...`);

      // Run validateInput if present
      if (this.skill.validateInput && ctx.params) {
        const valid = await this.skill.validateInput(ctx.params);
        if (!valid) {
          const durationMs = Math.round(performance.now() - start);
          logs.push(`[${this.skillId}] Input validation failed`);
          return {
            success: false,
            output: null,
            durationMs,
            error: `Input validation failed for skill "${this.skillId}"`,
            logs,
          };
        }
        logs.push(`[${this.skillId}] Input validation passed`);
      }

      // Execute the skill
      const result = await this.skill.execute(ctx);
      const durationMs = Math.round(performance.now() - start);

      logs.push(`[${this.skillId}] Execution ${result.success ? 'succeeded' : 'failed'} in ${durationMs}ms`);
      if (result.logs) logs.push(...result.logs);

      return {
        ...result,
        durationMs,
        logs,
      };
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const errorMsg = err instanceof Error ? err.message : String(err);
      logs.push(`[${this.skillId}] Execution threw: ${errorMsg}`);

      return {
        success: false,
        output: null,
        durationMs,
        error: errorMsg,
        logs,
      };
    }
  }

  async buildInjection(ctx: ExecutionContext): Promise<string | null> {
    if (this.skill.buildContext) {
      return this.skill.buildContext(ctx);
    }
    return null;
  }

  async validate(input: unknown): Promise<boolean> {
    if (this.skill.validateInput) {
      return this.skill.validateInput(input);
    }
    return true;
  }
}

// ─── Executor ──────────────────────────────────────────────────────────────

/**
 * Executor —— 技能编排器。
 *
 * 职责：
 * 1. 加载技能（委托 Loader）
 * 2. 校验技能（委托 Validator）
 * 3. 缓存技能（委托 Cache）
 * 4. 执行技能（委托 SkillExecutor）
 * 5. 事件发布（供上层监听执行生命周期）
 *
 * @example
 * ```typescript
 * const executor = new Executor({ autoValidate: true, enableCache: true });
 * const ctx: ExecutionContext = {
 *   agentType: 'code',
 *   triggerTags: ['refactor'],
 *   systemPrompt: '',
 *   taskDescription: 'Refactor the code',
 *   cwd: process.cwd(),
 *   contextFiles: [],
 * };
 * const results = await executor.executeMatching(ctx);
 * ```
 */
export class Executor {
  private readonly loader: Loader;
  private readonly validator: Validator;
  private readonly cache: Cache;
  private readonly skills: Map<string, SkillDefinition> = new Map();
  private readonly executors: Map<string, SkillExecutor> = new Map();
  private readonly listeners: Set<ExecutorEventListener> = new Set();
  private readonly options: Required<ExecutorOptions>;

  constructor(options: ExecutorOptions = {}) {
    this.options = {
      autoValidate: true,
      enableCache: true,
      loader: {},
      validator: {},
      cache: {},
      ...options,
    };
    this.loader = new Loader(this.options.loader);
    this.validator = new Validator(this.options.validator);
    this.cache = new Cache(this.options.cache);
  }

  // ─── 加载 ──────────────────────────────────────

  /**
   * 从目录加载所有技能。
   * 加载后自动执行 validate（如果 autoValidate 开启）。
   */
  async loadFromDirectory(baseDir: string): Promise<LoadResult> {
    const result = await this.loader.fromDirectory(baseDir);

    for (const skill of result.skills) {
      await this.registerSkill(skill);
      this.emit('skill:loaded', { skillId: skill.id });
    }

    if (this.options.autoValidate && result.skills.length > 0) {
      for (const skill of result.skills) {
        const validation = this.validateSkill(skill.id);
        if (validation && !validation.valid) {
          this.emit('skill:validated', { skillId: skill.id, result: validation });
        }
      }
    }

    return result;
  }

  /**
   * 从单个文件加载技能。
   */
  async loadFromFile(filePath: string): Promise<SkillDefinition | null> {
    const skill = await this.loader.fromFile(filePath);
    if (skill) {
      await this.registerSkill(skill);
      this.emit('skill:loaded', { skillId: skill.id });
    }
    return skill;
  }

  /**
   * 注册一个已有的 SkillDefinition 实例。
   * 适用于通过 Loader.fromObject() 或 Loader.fromJsonTemplate() 创建的技能。
   */
  async register(skill: SkillDefinition): Promise<void> {
    await this.registerSkill(skill);
    this.emit('skill:loaded', { skillId: skill.id });

    if (this.options.autoValidate) {
      const validation = this.validateSkill(skill.id);
      if (validation && !validation.valid) {
        this.emit('skill:validated', { skillId: skill.id, result: validation });
      }
    }
  }

  // ─── 执行 ──────────────────────────────────────

  /**
   * 执行指定技能。
   *
   * @param skillId - 技能 ID
   * @param ctx - 执行上下文
   * @returns 执行结果
   */
  async execute(skillId: string, ctx: ExecutionContext): Promise<ExecutionResult> {
    const executor = this.executors.get(skillId);
    if (!executor) {
      return {
        success: false,
        output: null,
        durationMs: 0,
        error: `Skill "${skillId}" is not registered`,
        logs: [],
      };
    }

    this.emit('skill:executing', { skillId, ctx });

    // Cache check
    if (this.options.enableCache) {
      if (this.cache.hasDefinition(skillId)) {
        this.emit('cache:hit', { skillId });
      } else {
        this.emit('cache:miss', { skillId });
      }
    }

    const result = await executor.execute(ctx);
    this.emit(result.success ? 'skill:executed' : 'skill:failed', {
      skillId,
      result,
    });

    return result;
  }

  /**
   * 根据标签匹配并执行技能。
   * 返回所有匹配技能的执行结果。
   *
   * @param ctx - 执行上下文
   * @returns 执行结果数组
   */
  async executeMatching(ctx: ExecutionContext): Promise<ExecutionResult[]> {
    const matched = this.matchByTags(ctx.triggerTags);
    const results: ExecutionResult[] = [];

    for (const skill of matched) {
      const result = await this.execute(skill.id, ctx);
      results.push(result);
    }

    return results;
  }

  // ─── 查询 ──────────────────────────────────────

  /**
   * 根据标签匹配技能。
   * 交集匹配：技能的 triggerTags 与查询标签至少有一个交集。
   */
  matchByTags(tags: string[]): SkillDefinition[] {
    const tagSet = new Set(tags);
    const matched: SkillDefinition[] = [];
    for (const skill of this.skills.values()) {
      if (skill.triggerTags.some((t) => tagSet.has(t))) {
        matched.push(skill);
      }
    }
    return matched;
  }

  /**
   * 根据 Agent 类型匹配技能。
   */
  matchByAgentType(agentType: string): SkillDefinition[] {
    return Array.from(this.skills.values()).filter((s) =>
      s.agentTypes.includes(agentType),
    );
  }

  /**
   * 获取已注册的全部技能。
   */
  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取指定技能。
   */
  getSkill(skillId: string): SkillDefinition | undefined {
    return this.skills.get(skillId);
  }

  // ─── 校验 ──────────────────────────────────────

  /**
   * 校验指定技能。
   */
  validateSkill(skillId: string): ValidationResult | null {
    const skill = this.skills.get(skillId);
    if (!skill) return null;

    // 缓存检查
    if (this.options.enableCache) {
      const cached = this.cache.getValidation(skillId);
      if (cached) return cached;
    }

    const result = this.validator.validate(skill);

    if (this.options.enableCache) {
      this.cache.setValidation(skillId, result);
    }

    return result;
  }

  /**
   * 校验所有已注册技能。
   */
  validateAll(): Map<string, ValidationResult> {
    return this.validator.validateAll(Array.from(this.skills.values()));
  }

  // ─── 生命周期管理 ──────────────────────────────

  /**
   * 移除技能并调用 onDestroy。
   */
  async unregister(skillId: string): Promise<boolean> {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    if (skill.onDestroy) {
      await skill.onDestroy();
    }

    this.skills.delete(skillId);
    this.executors.delete(skillId);
    this.cache.evictDefinition(skillId);
    return true;
  }

  /**
   * 清空所有技能。
   */
  async clear(): Promise<void> {
    for (const [id] of this.skills) {
      await this.unregister(id);
    }
    this.cache.clear();
  }

  // ─── 事件系统 ──────────────────────────────────

  /**
   * 注册事件监听器。
   * 返回取消订阅函数。
   */
  on(listener: ExecutorEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 移除事件监听器。
   */
  off(listener: ExecutorEventListener): void {
    this.listeners.delete(listener);
  }

  // ─── 统计 ──────────────────────────────────────

  /** 执行器统计信息 */
  stats(): {
    loadedSkills: number;
    cache: { definitions: number; validations: number; renders: number; maxSize: number };
  } {
    return {
      loadedSkills: this.skills.size,
      cache: this.cache.stats(),
    };
  }

  // ─── 内部方法 ──────────────────────────────────

  private async registerSkill(skill: SkillDefinition): Promise<void> {
    this.skills.set(skill.id, skill);

    // 调用 onInit 钩子
    if (skill.onInit) {
      await skill.onInit();
    }

    // 创建并注册默认 SkillExecutor
    this.executors.set(skill.id, new DefaultSkillExecutor(skill));

    // 写入缓存
    if (this.options.enableCache) {
      this.cache.setDefinition(skill);
    }
  }

  private emit(event: ExecutorEvent, data: unknown): void {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch {
        // 监听器异常不应影响主流程
      }
    }
  }
}
