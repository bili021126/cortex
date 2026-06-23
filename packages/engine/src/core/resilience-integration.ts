// ============================================================
// @cortex/engine/core/resilience-integration —— 韧性策略引擎集成
//
// @layer 治理层
// @role 恢复者——仅执行层调用，不跨层暴露
//
// 职责：
//   将 @cortex/resilience 的策略（重试/断路器/超时）集成到引擎核心组件。
//   为 EnvironmentAwareRouter、TaskRouter 等提供韧性增强。
//
// 设计原则：
//   1. 韧性是横切关注点——通过 Registry 统一管理，不侵入核心逻辑
//   2. 策略可配置——每个组件的韧性策略独立配置
//   3. 可观测性——韧性事件（重试/断路/超时）走遥测管道
// ============================================================

import {
  Registry,
  ExponentialBackoff,
  SimpleCircuitBreaker,
  FixedTimeout,
  type ResilienceEvent,
} from "@cortex/resilience";
import { recordTelemetry } from "@cortex/telemetry";

/**
 * 韧性策略配置——引擎组件的韧性增强选项。
 */
export interface ResilienceOptions {
  /** 重试策略 */
  retry?: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  /** 断路器策略 */
  circuitBreaker?: {
    threshold: number;
    halfOpenAfterMs: number;
  };
  /** 超时策略 */
  timeout?: {
    timeoutMs: number;
  };
}

/**
 * 韧性策略工厂——根据配置创建并注册策略实例。
 */
export class ResiliencePolicyFactory {
  private readonly registry: Registry;

  constructor() {
    this.registry = new Registry();
    this._setupEventListeners();
  }

  /**
   * 注册韧性策略——为指定组件注册 retry + circuit breaker + timeout。
   *
   * @param componentName 组件名（用于 Registry key 和遥测标签）
   * @param options 韧性配置
   */
  registerPolicies(componentName: string, options: ResilienceOptions): void {
    // 重试策略
    const retry = new ExponentialBackoff({
      maxAttempts: options.retry?.maxAttempts ?? 3,
      baseDelayMs: options.retry?.baseDelayMs ?? 1000,
      maxDelayMs: options.retry?.maxDelayMs ?? 10000,
    });

    // 断路器
    const circuitBreaker = new SimpleCircuitBreaker({
      name: componentName,
      threshold: options.circuitBreaker?.threshold ?? 5,
      halfOpenAfterMs: options.circuitBreaker?.halfOpenAfterMs ?? 60000,
    });

    // 超时
    const timeout = new FixedTimeout({
      durationMs: options.timeout?.timeoutMs ?? 30000,
    });

    // 注册到 Registry（统一管理和执行）
    this.registry.register(componentName, { retry, circuitBreaker, timeout });
  }

  /**
   * 执行韧性保护函数——通过 Registry 组合 retry + circuit breaker + timeout。
   *
   * @param componentName 组件名（必须已注册）
   * @param fn 被保护的异步函数
   * @returns 执行结果
   */
  async execute<T>(componentName: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await this.registry.execute(componentName, fn);
void recordTelemetry(`${componentName}.resilience.success`, Date.now() - start, [
        { key: "component", value: componentName },
      ]).catch(err => process.stderr.write(`[resilience] success telemetry failed: ${err instanceof Error ? err.message : String(err)}\n`));
      return result;
    } catch (e) {
void recordTelemetry(`${componentName}.resilience.failure`, Date.now() - start, [
        { key: "component", value: componentName },
        { key: "error", value: String(e).slice(0, 200) },
      ]).catch(err => process.stderr.write(`[resilience] failure telemetry failed: ${err instanceof Error ? err.message : String(err)}\n`));
      throw e;
    }
  }

  /**
   * 获取 Registry 实例——用于高级场景（如手动发射韧性事件）。
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * 设置韧性事件监听器——将 Registry 事件转发到遥测。
   */
  private _setupEventListeners(): void {
    this.registry.onEvent((event: ResilienceEvent) => {
      void recordTelemetry(`resilience.event.${event.type.toLowerCase()}`, 0, [
        { key: "name", value: event.name },
        { key: "type", value: event.type },
      ]).catch(err => process.stderr.write(`[resilience] event telemetry failed: ${err instanceof Error ? err.message : String(err)}\n`));
    });
  }
}

/**
 * 全局韧性策略工厂单例——引擎启动时初始化。
 */
export const resilienceFactory = new ResiliencePolicyFactory();
