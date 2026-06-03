// ============================================================
// 🌿 Cortex 技能注册表 — 服务容器实现
// 设计：纳西妲 | 实现：阿贝多
//
// 轻量级 DI 容器，为技能提供运行时服务
//
// @moved-from projects/solo-flight/src/context/service-container.ts
// ============================================================

import type { ServiceContainer } from './types.js';

export class DefaultServiceContainer implements ServiceContainer {
  private readonly services = new Map<string, unknown>();

  get<T>(token: string): T {
    const service = this.services.get(token);
    if (service === undefined) {
      throw new Error(`服务「${token}」未注册`);
    }
    return service as T;
  }

  register<T>(token: string, instance: T): void {
    if (this.services.has(token)) {
      throw new Error(`服务「${token}」已被注册`);
    }
    this.services.set(token, instance);
  }

  has(token: string): boolean {
    return this.services.has(token);
  }
}
