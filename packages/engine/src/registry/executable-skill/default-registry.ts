// ============================================================
// 🌿 Cortex 技能注册表 — 默认注册表实现
// 设计：纳西妲 | 实现：阿贝多
//
// DefaultSkillRegistry 是系统的核心枢纽，职责：
// 1. 管理技能的注册/注销/查找 —— 基于 Map 的 O(1) 存储
// 2. 维护技能依赖关系图 —— DAG + 循环依赖检测
// 3. 协调技能生命周期 —— 实例缓存 + onInit/onDestroy
// 4. 提供中间件拦截能力 —— Koa-like 洋葱模型
// 5. 事件发布-订阅 —— 生命周期钩子
//
// @moved-from projects/solo-flight/src/registry/default-registry.ts
// ============================================================

import type {
  Skill,
  SkillId,
  SkillMeta,
  SkillInput,
  SkillResult,
  RegistryFilter,
  RegisterOptions,
  RegistryEvent,
  RegistryEventHandler,
  SkillMiddleware,
  MiddlewareContext,
  ExecutionContext,
  ServiceContainer,
  Logger,
} from './types.js';

import type {
  SkillRegistry,
  ISkillContainer,
  IDependencyGraph,
} from './interfaces.js';

import { DependencyGraph } from './dependency-graph.js';
import { SkillContainer } from './container.js';
import { LifecycleManager } from './lifecycle.js';
import { compose } from './middleware.js';
import { DefaultExecutionContext } from './skill-execution-context.js';
import { validateSkillMeta, formatValidationErrors } from './utils/validator.js';
import { generateTraceId } from './utils/id.js';
import {
  skillNotFound,
  validationFailed,
} from './errors.js';

export interface DefaultRegistryOptions {
  /** 默认超时时间 (ms) */
  defaultTimeout?: number;
  /** 默认重试次数 */
  defaultMaxRetries?: number;
  /** 日志记录器 */
  logger?: Logger;
  /** 服务容器 */
  serviceContainer?: ServiceContainer;
}

/** 默认日志记录器 */
const defaultLogger: Logger = {
  info: (...args) => console.warn('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: (...args) => console.warn('[DEBUG]', ...args),
};

export class DefaultSkillRegistry implements SkillRegistry {
  // ============ 内部状态 ============

  /** 元信息存储 */
  private readonly metaStore = new Map<SkillId, SkillMeta>();

  /** 技能实例（技能实例本身，用于工厂创建） */
  private readonly skillMap = new Map<SkillId, Skill>();

  /** 依赖图 */
  private readonly dependencyGraph: IDependencyGraph = new DependencyGraph();

  /** 技能容器（管理实例缓存和生命周期） */
  private readonly container: ISkillContainer;

  /** 生命周期管理器 */
  private readonly lifecycle: LifecycleManager = new LifecycleManager();

  /** 中间件链 */
  private readonly middlewares: SkillMiddleware[] = [];

  /** 组合后的根中间件 */
  private composedMiddleware: SkillMiddleware | null = null;

  /** 日志记录器 */
  private readonly logger: Logger;

  /** 服务容器 */
  private readonly serviceContainer: ServiceContainer;

  /** 默认超时 */
  private readonly defaultTimeout: number;

  /** 默认最大重试次数 */
  private readonly defaultMaxRetries: number;

  /** 注册表是否已启动 */
  private _started = false;

  constructor(options?: DefaultRegistryOptions) {
    this.logger = options?.logger ?? defaultLogger;
    this.serviceContainer = options?.serviceContainer ?? {
      get: () => { throw new Error('服务容器未配置'); },
      register: () => { throw new Error('服务容器未配置'); },
      has: () => false,
    };
    this.defaultTimeout = options?.defaultTimeout ?? 30_000;
    this.defaultMaxRetries = options?.defaultMaxRetries ?? 0;

    // 技能容器工厂
    this.container = new SkillContainer(async (skillId: SkillId) => {
      const skill = this.skillMap.get(skillId);
      if (!skill) {
        throw new Error(`技能「${skillId}」未找到实例工厂`);
      }
      return skill;
    });
  }

  // ==========================================================
  // 注册与注销
  // ==========================================================

  async register<T extends Skill>(
    skill: T,
    options?: RegisterOptions
  ): Promise<{ success: true } | { success: false; error: string }> {
    const meta = skill.meta;

    // 1. 校验技能元信息
    const validationErrors = validateSkillMeta(meta);
    if (validationErrors.length > 0) {
      return {
        success: false,
        error: `技能「${meta.id}」元信息校验失败:\n${formatValidationErrors(validationErrors)}`,
      };
    }

    // 2. 触发 beforeRegister 事件
    await this.lifecycle.emit('beforeRegister', { skillId: meta.id });

    // 3. 检查是否已存在
    if (this.metaStore.has(meta.id) && !options?.overwrite) {
      return {
        success: false,
        error: `技能「${meta.id}」已注册（使用 --overwrite 覆盖）`,
      };
    }

    // 4. 检查依赖是否可解析
    for (const depId of meta.dependencies) {
      if (!this.metaStore.has(depId) && !this.skillMap.has(depId)) {
        return {
          success: false,
          error: `技能「${meta.id}」的依赖「${depId}」未注册`,
        };
      }
    }

    // 5. 加入依赖图并检测循环依赖
    this.dependencyGraph.addNode(meta.id, meta.dependencies);
    const cycle = this.dependencyGraph.detectCycle();
    if (cycle) {
      this.dependencyGraph.removeNode(meta.id);
      return {
        success: false,
        error: `技能「${meta.id}」导致循环依赖: ${cycle.join(' → ')}`,
      };
    }

    // 6. 存入存储
    this.metaStore.set(meta.id, meta);
    this.skillMap.set(meta.id, skill);

    // 7. 若非懒加载，立即预热
    if (!options?.lazy) {
      try {
        await this.container.warmUp(meta.id);
      } catch (err) {
        // 预热失败则回滚注册
        this.metaStore.delete(meta.id);
        this.skillMap.delete(meta.id);
        this.dependencyGraph.removeNode(meta.id);
        return {
          success: false,
          error: `技能「${meta.id}」初始化失败: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // 8. 触发 afterRegister 事件
    await this.lifecycle.emit('afterRegister', { skillId: meta.id, meta });

    this.logger.info(`✅ 技能已注册: ${meta.id}@${meta.version}`);
    return { success: true };
  }

  async registerMany(
    skills: Skill[],
    options?: RegisterOptions
  ): Promise<Array<{ success: true; id: SkillId } | { success: false; id?: SkillId; error: string }>> {
    const results: Array<{ success: true; id: SkillId } | { success: false; id?: SkillId; error: string }> = [];

    for (const skill of skills) {
      const result = await this.register(skill, options);
      if (result.success) {
        results.push({ success: true, id: skill.meta.id });
      } else {
        results.push({ success: false, id: skill.meta.id, error: result.error });
      }
    }

    return results;
  }

  async unregister(skillId: SkillId): Promise<{ success: true } | { success: false; error: string }> {
    if (!this.metaStore.has(skillId)) {
      return { success: false, error: `技能「${skillId}」未注册` };
    }

    await this.lifecycle.emit('beforeUnregister', { skillId });

    // 检查是否有其他技能依赖于它
    const dependents = this.dependencyGraph.getDependents(skillId);
    if (dependents.length > 0) {
      return {
        success: false,
        error: `技能「${skillId}」被其他技能依赖，无法注销: ${dependents.join(', ')}`,
      };
    }

    // 销毁实例
    try {
      await this.container.destroy(skillId);
    } catch (err) {
      this.logger.warn(`销毁技能「${skillId}」实例时出错: ${err}`);
    }

    this.metaStore.delete(skillId);
    this.skillMap.delete(skillId);
    this.dependencyGraph.removeNode(skillId);

    await this.lifecycle.emit('afterUnregister', { skillId });

    this.logger.info(`🗑️ 技能已注销: ${skillId}`);
    return { success: true };
  }

  // ==========================================================
  // 查找与解析
  // ==========================================================

  getMeta(skillId: SkillId): SkillMeta | undefined {
    return this.metaStore.get(skillId);
  }

  find(filter: RegistryFilter): SkillMeta[] {
    let results = Array.from(this.metaStore.values());

    if (filter.category !== undefined) {
      results = results.filter((m) => m.category === filter.category);
    }

    if (filter.tags && filter.tags.length > 0) {
      results = results.filter((m) =>
        filter.tags!.some((tag) => m.tags.includes(tag))
      );
    }

    if (filter.version) {
      results = results.filter((m) => m.version === filter.version);
    }

    if (filter.search) {
      const q = filter.search.toLowerCase();
      results = results.filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    return results;
  }

  getAll(): ReadonlyMap<SkillId, SkillMeta> {
    return this.metaStore;
  }

  has(skillId: SkillId): boolean {
    return this.metaStore.has(skillId);
  }

  count(): number {
    return this.metaStore.size;
  }

  async resolveDependencies(skillId: SkillId): Promise<
    { success: true; chain: SkillId[] } | { success: false; error: string }
  > {
    if (!this.metaStore.has(skillId)) {
      return { success: false, error: `技能「${skillId}」未注册` };
    }

    const chain = this.dependencyGraph.getDependencies(skillId);
    return { success: true, chain };
  }

  // ==========================================================
  // 执行
  // ==========================================================

  async execute<TInput = unknown, TOutput = unknown>(
    skillId: SkillId,
    input: SkillInput<TInput>
  ): Promise<SkillResult<TOutput>> {
    const startTime = Date.now();

    // 1. 查找技能
    const meta = this.metaStore.get(skillId);
    if (!meta) {
      return {
        success: false,
        error: skillNotFound(skillId),
        meta: { duration: 0, version: '0.0.0' as SkillId as any, retryCount: 0, timestamp: Date.now() },
      };
    }

    try {
      // 2. 触发 beforeExecute 事件
      await this.lifecycle.emit('beforeExecute', { skillId, input });

      // 3. 获取技能实例
      const skill = await this.container.get<Skill<TInput, TOutput>>(skillId);

      // 4. 输入校验
      if (skill.validate && !skill.validate(input.params)) {
        return {
          success: false,
          error: validationFailed(skillId, '参数校验不通过'),
          meta: { duration: Date.now() - startTime, version: meta.version, retryCount: 0, timestamp: Date.now() },
        };
      }

      // 5. 构建执行上下文
      const context = this.buildExecutionContext(skillId, input);

      // 6. 通过中间件链执行
      const result = await this.executeWithMiddleware(skill, context, input);

      // 7. 补全执行元信息
      const duration = Date.now() - startTime;
      const finalResult: SkillResult<TOutput> = {
        ...result,
        meta: {
          ...(result as any).meta,
          duration: (result as any).meta?.duration ?? duration,
          version: meta.version,
          retryCount: 0,
          timestamp: Date.now(),
        },
      };

      // 8. 触发 afterExecute 事件
      await this.lifecycle.emit('afterExecute', { skillId, result: finalResult });

      return finalResult;
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorResult: SkillResult<TOutput> = {
        success: false,
        error: err instanceof Error
          ? { code: 'SKILL_EXECUTION_FAILED' as any, message: err.message, cause: err }
          : { code: 'SKILL_EXECUTION_FAILED' as any, message: String(err) },
        meta: { duration, version: meta.version, retryCount: 0, timestamp: Date.now() },
      };

      await this.lifecycle.emit('onError', { skillId, error: errorResult.error });
      return errorResult;
    }
  }

  /** 构建执行上下文 */
  private buildExecutionContext(skillId: SkillId, input: SkillInput): ExecutionContext {
    const traceId = input.traceId ?? generateTraceId();

    return new DefaultExecutionContext({
      input: { ...input, traceId },
      services: this.serviceContainer,
      logger: this.logger,
      signal: input.signal ?? new AbortController().signal,
      store: new Map(),
      getDependencyResult: async <T>(depId: SkillId) => {
        if (!this.metaStore.has(depId)) {
          return {
            success: false,
            error: skillNotFound(depId),
            meta: { duration: 0, version: '0.0.0' as any, retryCount: 0, timestamp: Date.now() },
          };
        }
        return await (this.execute<T>(depId, input as SkillInput<T>) as Promise<SkillResult<T>>);
      },
    });
  }

  /** 通过中间件链执行技能 */
  private async executeWithMiddleware<TInput, TOutput>(
    skill: Skill<TInput, TOutput>,
    context: ExecutionContext,
    input: SkillInput<TInput>
  ): Promise<SkillResult<TOutput>> {
    // 获取或组合中间件
    if (!this.composedMiddleware && this.middlewares.length > 0) {
      this.composedMiddleware = compose([...this.middlewares]);
    }

    if (this.composedMiddleware) {
      const middlewareCtx: MiddlewareContext = {
        skill: { meta: skill.meta },
        input,
        logger: this.logger,
      };

      let skillExecuted = false;
      let skillResult: SkillResult<TOutput> | null = null;

      await this.composedMiddleware(middlewareCtx, async () => {
        skillExecuted = true;
        skillResult = await skill.run(context);
      });

      if (!skillExecuted) {
        return {
          success: false,
          error: { code: 'SKILL_INTERNAL_ERROR' as any, message: '中间件链未执行技能' },
        };
      }

      return skillResult!;
    }

    // 无中间件，直接执行
    return await skill.run(context);
  }

  // ==========================================================
  // 生命周期
  // ==========================================================

  on(event: RegistryEvent, handler: RegistryEventHandler): void {
    this.lifecycle.on(event, handler);
  }

  use(middleware: SkillMiddleware): void {
    this.middlewares.push(middleware);
    // 清除缓存的组合中间件，下次执行时重新组合
    this.composedMiddleware = null;
  }

  async start(): Promise<{ success: true } | { success: false; error: string }> {
    if (this._started) {
      return { success: false, error: '注册表已启动' };
    }

    this.logger.info('🚀 技能注册表启动中...');

    // 1. 检测所有注册技能的循环依赖
    const cycle = this.dependencyGraph.detectCycle();
    if (cycle) {
      return {
        success: false,
        error: `注册表启动失败：检测到循环依赖: ${cycle.join(' → ')}`,
      };
    }

    // 2. 触发 onStartup 事件
    await this.lifecycle.emit('onStartup', { skillCount: this.metaStore.size });

    this._started = true;
    this.logger.info(`✅ 技能注册表启动完成，已注册 ${this.metaStore.size} 个技能`);
    return { success: true };
  }

  async shutdown(): Promise<{ success: true } | { success: false; error: string }> {
    if (!this._started) {
      return { success: false, error: '注册表未启动' };
    }

    this.logger.info('🛑 技能注册表关闭中...');

    await this.lifecycle.emit('onShutdown', { skillCount: this.metaStore.size });

    try {
      await this.container.destroyAll();
    } catch (err) {
      this.logger.warn(`销毁技能实例时出错: ${err}`);
    }

    this.metaStore.clear();
    this.skillMap.clear();
    this.dependencyGraph.clear();
    this.lifecycle.clear();
    this._started = false;

    this.logger.info('✅ 技能注册表已关闭');
    return { success: true };
  }

  // ==========================================================
  // 注册表入口
  // ==========================================================

  get registry(): SkillRegistry {
    return this;
  }
}
