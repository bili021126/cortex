// ============================================================
// 🌿 Cortex 技能注册表 — 技能容器（实例管理）
// 设计：纳西妲 | 实现：阿贝多
//
// 职责：
// 1. 管理技能实例的创建、缓存、销毁
// 2. 支持懒加载（首次执行时才实例化）
// 3. 管理技能生命周期（onInit / onDestroy）
//
// @moved-from projects/solo-flight/src/registry/container.ts
// ============================================================

import type { Skill, SkillId } from './types.js';
import type { ISkillContainer } from './interfaces.js';

export class SkillContainer implements ISkillContainer {
  /** 技能工厂——根据 SkillId 创建技能实例 */
  private readonly factory: (skillId: SkillId) => Promise<Skill>;

  /** 实例缓存 */
  private readonly cache = new Map<SkillId, Skill>();

  /** 正在实例化的 Promise（防止并发重复创建） */
  private readonly pending = new Map<SkillId, Promise<Skill>>();

  constructor(factory: (skillId: SkillId) => Promise<Skill>) {
    this.factory = factory;
  }

  async get<T extends Skill>(skillId: SkillId): Promise<T> {
    // 缓存命中
    const cached = this.cache.get(skillId) as T | undefined;
    if (cached) return cached;

    // 检查是否正在实例化（去重）
    const pending = this.pending.get(skillId) as Promise<T> | undefined;
    if (pending) return await pending;

    // 创建实例
    const createPromise = this.factory(skillId).then(async (skill) => {
      // 调用 onInit 生命周期钩子
      if (skill.onInit) {
        await skill.onInit();
      }
      this.cache.set(skillId, skill);
      this.pending.delete(skillId);
      return skill;
    });

    this.pending.set(skillId, createPromise);
    return await (createPromise as Promise<T>);
  }

  isCached(skillId: SkillId): boolean {
    return this.cache.has(skillId);
  }

  async warmUp(skillId: SkillId): Promise<void> {
    await this.get(skillId);
  }

  async destroy(skillId: SkillId): Promise<void> {
    const instance = this.cache.get(skillId);
    if (instance) {
      if (instance.onDestroy) {
        await instance.onDestroy();
      }
      this.cache.delete(skillId);
    }
    this.pending.delete(skillId);
  }

  async destroyAll(): Promise<void> {
    const errors: Array<{ id: SkillId; error: unknown }> = [];

    for (const [skillId, instance] of this.cache) {
      try {
        if (instance.onDestroy) {
          await instance.onDestroy();
        }
      } catch (err) {
        errors.push({ id: skillId, error: err });
      }
    }

    this.cache.clear();
    this.pending.clear();

    if (errors.length > 0) {
      const messages = errors.map((e) => `[${e.id}]: ${e.error}`).join('; ');
      throw new Error(`技能销毁过程中出现 ${errors.length} 个错误: ${messages}`);
    }
  }

  /** 获取缓存的技能数量 */
  get cacheSize(): number {
    return this.cache.size;
  }
}
