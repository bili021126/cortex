/**
 * registry.context —— 由 Registry.ts 拆分（2026-06-20 RES-1）。
 */

import type { AsyncLocalStorage } from "node:async_hooks";
import { hasAsyncLocalStorage } from "../utils.js";

// ============================================================
// ── 执行上下文 ──
// ============================================================

/**
 * ResilienceContext —— 执行韧性策略时的共享上下文。
 *
 * 记录执行链路信息，供日志、监控、事件溯源使用。
 */
export interface ResilienceContext {
  /** 全局唯一执行 ID */
  readonly executionId: string;
  /** 策略名称 */
  readonly policyName: string;
  /** 策略名称链 */
  readonly policyChain: string[];
  /** 起始时间戳 */
  readonly startedAt: number;
  /** 重试计数器 */
  attempt: number;
  /** 自定义属性 */
  metadata: Map<string, unknown>;
}

/**
 * ResilienceContextManager —— 上下文管理器（基于 AsyncLocalStorage）。
 *
 * 确保同一链路共享同一上下文，无需显式传递。
 * 在 Node.js 环境中使用 AsyncLocalStorage 实现异步上下文传播。
 */
export class ResilienceContextManager {
  private static readonly _storage: AsyncLocalStorage<ResilienceContext> | null = (() => {
    if (!hasAsyncLocalStorage()) return null;
    const ALS = (globalThis as Record<string, unknown>).AsyncLocalStorage as new () => AsyncLocalStorage<ResilienceContext>;
    return typeof ALS === 'function' ? new ALS() : null;
  })();

  /**
   * 在上下文中执行异步函数。
   * 自动生成 executionId 并注入上下文。
   */
  static async run<T>(policyName: string, fn: (ctx: ResilienceContext) => Promise<T>): Promise<T> {
    const context: ResilienceContext = {
      executionId: ResilienceContextManager._generateId(),
      policyName,
      policyChain: [policyName],
      startedAt: Date.now(),
      attempt: 0,
      metadata: new Map(),
    };

    if (this._storage) {
      return await this._storage.run(context, () => fn(context));
    }
    // 降级：无 AsyncLocalStorage 时直接执行
    return await fn(context);
  }

  /** 获取当前上下文 */
  static current(): ResilienceContext | undefined {
    return this._storage?.getStore();
  }

  /** 生成全局唯一执行 ID */
  private static _generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${random}`;
  }
}

// ============================================================
// ── IResilienceRegistry 接口 —— 注册中心契约 ──
// ============================================================

/**
 * IResilienceRegistry —— 韧性策略注册中心接口。
 *
 * 职责：
 * 1. 注册/查询/卸载策略实例
 * 2. 组合执行（retry → circuitBreaker → timeout 嵌套）
 * 3. 状态快照与监控
 * 4. 全局事件通知
 */
