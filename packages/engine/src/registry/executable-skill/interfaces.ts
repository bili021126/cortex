// ============================================================
// 🌿 Cortex 技能注册表 — 接口定义层
// 设计：纳西妲 | 实现：阿贝多
//
// @moved-from projects/solo-flight/src/registry/interfaces.ts
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
} from './types.js';

// ============ 注册表核心接口 ============

/**
 * 技能注册表——系统的核心枢纽
 *
 * 职责：
 * 1. 管理技能的注册/注销/查找
 * 2. 维护技能依赖关系图
 * 3. 协调技能生命周期
 * 4. 提供中间件拦截能力
 */
export interface SkillRegistry {
  // ============ 注册与注销 ============

  /** 注册一个技能 */
  register<T extends Skill>(
    skill: T,
    options?: RegisterOptions
  ): Promise<{ success: true } | { success: false; error: string }>;

  /** 批量注册技能 */
  registerMany(
    skills: Skill[],
    options?: RegisterOptions
  ): Promise<Array<{ success: true; id: SkillId } | { success: false; id?: SkillId; error: string }>>;

  /** 注销一个技能 */
  unregister(skillId: SkillId): Promise<{ success: true } | { success: false; error: string }>;

  // ============ 查找与解析 ============

  /** 按 ID 查找技能元信息 */
  getMeta(skillId: SkillId): SkillMeta | undefined;

  /** 按条件查找技能列表 */
  find(filter: RegistryFilter): SkillMeta[];

  /** 获取所有已注册技能 */
  getAll(): ReadonlyMap<SkillId, SkillMeta>;

  /** 检查技能是否已注册 */
  has(skillId: SkillId): boolean;

  /** 获取已注册技能数量 */
  count(): number;

  /** 解析技能依赖（返回拓扑排序后的依赖链） */
  resolveDependencies(skillId: SkillId): Promise<
    { success: true; chain: SkillId[] } | { success: false; error: string }
  >;

  // ============ 执行 ============

  /** 执行指定技能 */
  execute<TInput = unknown, TOutput = unknown>(
    skillId: SkillId,
    input: SkillInput<TInput>
  ): Promise<SkillResult<TOutput>>;

  // ============ 生命周期 ============

  /** 注册生命周期钩子 */
  on(event: RegistryEvent, handler: RegistryEventHandler): void;

  /** 添加中间件 */
  use(middleware: SkillMiddleware): void;

  /** 启动注册表（预热缓存、校验依赖） */
  start(): Promise<{ success: true } | { success: false; error: string }>;

  /** 关闭注册表（销毁所有技能实例） */
  shutdown(): Promise<{ success: true } | { success: false; error: string }>;
}

// ============ 依赖图接口 ============

/** 依赖图——管理技能间的依赖关系和循环依赖检测 */
export interface IDependencyGraph {
  /** 添加依赖关系 */
  addNode(skillId: SkillId, dependencies: SkillId[]): void;
  /** 移除节点 */
  removeNode(skillId: SkillId): void;
  /** 检测是否存在循环依赖，返回循环路径（如果有） */
  detectCycle(): SkillId[] | null;
  /** 拓扑排序，返回排序后的 ID 列表 */
  topologicalSort(): SkillId[];
  /** 获取某个技能的所有依赖（递归） */
  getDependencies(skillId: SkillId): SkillId[];
  /** 获取某个技能的直接依赖 */
  getDirectDependencies(skillId: SkillId): SkillId[];
  /** 获取依赖于某个技能的所有技能 */
  getDependents(skillId: SkillId): SkillId[];
  /** 获取所有节点 */
  getNodes(): SkillId[];
  /** 清空 */
  clear(): void;
}

// ============ 技能容器接口 ============

/** 技能容器——管理技能实例的创建、缓存和销毁 */
export interface ISkillContainer {
  /** 获取技能实例（从缓存获取或创建） */
  get<T extends Skill>(skillId: SkillId): Promise<T>;
  /** 检查实例是否已缓存 */
  isCached(skillId: SkillId): boolean;
  /** 预创建并缓存技能实例 */
  warmUp(skillId: SkillId): Promise<void>;
  /** 销毁指定技能实例 */
  destroy(skillId: SkillId): Promise<void>;
  /** 销毁所有实例 */
  destroyAll(): Promise<void>;
}

// ============ 技能扫描器接口 ============

/** 技能扫描器——从文件系统自动发现并注册技能 */
export interface SkillScanner {
  /** 扫描指定目录，自动注册所有技能 */
  scan(directory: string): Promise<SkillMeta[]>;
}

// ============ 技能加载器接口 ============

/** 技能加载器——按需加载技能模块 */
export interface SkillLoader {
  load(skillId: SkillId): Promise<Skill>;
  /** 从文件路径加载技能 */
  loadFromFile(filePath: string): Promise<Skill>;
}
