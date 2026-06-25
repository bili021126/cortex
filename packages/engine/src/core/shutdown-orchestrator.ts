/**
 * core/shutdown-orchestrator.ts — 统一生命周期编排器
 *
 * 替代 bootstrapEngine 内联 shutdown、LifecycleManager、ShutdownWarden
 * 等分散的关闭逻辑，提供单一的 register → bootstrap → shutdown 编排。
 *
 * 设计原则：
 * - 接口从 @cortex/shared 导入（ILifecycle）
 * - 构造函数注入（可选 observer）
 * - 组件式/可插拔——不绑定任何引擎实现
 *
 * @module engine/core/shutdown-orchestrator
 * @since v3.x — 统一关闭编排
 */

import type { ILifecycle } from "@cortex/shared";
import { PipelineEventType, PipelinePriority, type IPipelineObserver, type ObservableEvent } from "@cortex/shared";

/**
 * ShutdownOrchestrator —— 统一关闭编排器。
 *
 * 用法：
 *   const orchestrator = new ShutdownOrchestrator(observer);
 *   orchestrator.register("memory", memoryStore);
 *   orchestrator.register("scheduler", scheduler, ["memory"]);
 *   await orchestrator.bootstrap();   // 正向 init + start
 *   await orchestrator.shutdown();    // 反向 stop + dispose + 超时保护
 */
export class ShutdownOrchestrator {
  private components = new Map<string, ILifecycle>();
  private order: string[] = [];
  private readonly SHUTDOWN_TIMEOUT_MS = 10_000;
  private _observer?: IPipelineObserver;

  constructor(observer?: IPipelineObserver) {
    this._observer = observer;
  }

  /**
   * 注册组件及其依赖。
   *
   * @param name 唯一组件名
   * @param component ILifecycle 实现
   */
  register(name: string, component: ILifecycle): void {
    this.components.set(name, component);
    this.order.push(name);
  }

  /**
   * 正向启动——按注册顺序依次 init() → start()。
   */
  async bootstrap(): Promise<void> {
    for (const name of this.order) {
      const c = this.components.get(name);
      if (!c) throw new Error(`[ShutdownOrchestrator] component not found: ${name}`);
      await c.init?.();
      await c.start?.();
    }
  }

  /**
   * 反向关闭——后注册的先关闭。
   * 每个组件依次执行 stop() → dispose()，每步带超时保护。
   */
  async shutdown(): Promise<void> {
    for (const name of [...this.order].reverse()) {
      const c = this.components.get(name);
      if (!c) continue;
      try {
        await Promise.race([
          (async () => {
            await c.stop?.();
            c.dispose?.();
          })(),
          new Promise<void>((_, reject) =>
            setTimeout(
              () => reject(new Error(`[ShutdownOrchestrator] shutdown timeout: ${name}`)),
              this.SHUTDOWN_TIMEOUT_MS,
            ),
          ),
        ]);
      } catch (err) {
        this._emitComponentError(name, err);
      }
    }
  }

  /** 发射组件关闭失败事件到 PipelineObserver */
  private _emitComponentError(name: string, err: unknown): void {
    if (!this._observer) return;
    const event: ObservableEvent = {
      type: PipelineEventType.ExecLifecyclePhaseChanged,
      priority: PipelinePriority.HIGH,
      payload: {
        from: "running",
        to: "shutdown",
        phase: "component_error",
        component: name,
        error: String(err),
      },
      timestamp: Date.now(),
      notificationType: "WARNING",
    };
    this._observer.emit(event);
  }
}
