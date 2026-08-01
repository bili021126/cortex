// @layer 规划-执行层
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
import { PipelineEventType, PipelinePriority, type IPipelineObserver } from "@cortex/shared";

/** 最小 AgentTracker 接口——避免直接依赖 @cortex/scheduler */
export interface AgentTrackerLike {
  syncLifecycleState(agentId: string, lifecyclePhase: 'start' | 'stop' | 'dispose'): void;
}

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
  /** 可选的 AgentTracker 引用——shutdown 时同步生命周期状态 */
  private _agentTracker?: AgentTrackerLike;
  /** P2 fix: 幂等守卫——shutdown 已开始/完成时重复调用直接返回 */
  private _shuttingDown = false;

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
   * 同时通知 AgentTracker 生命周期状态变更。
   */
  async shutdown(): Promise<void> {
    // P2 fix: 幂等守卫——重复 shutdown 直接返回，防止二次关闭副作用
    if (this._shuttingDown) return;
    this._shuttingDown = true;

    for (const name of [...this.order].reverse()) {
      const c = this.components.get(name);
      if (!c) continue;
      try {
        const componentPhase = c.phase;
        // P2 fix: 超时后不再 reject 中断——记录跳过并继续后续组件关闭；
        //   后台任务交由进程退出路径收尾（或由组件自身 dispose 保障）
        const timedOut = await new Promise<boolean>((resolve) => {
          const timeoutId = setTimeout(() => resolve(true), this.SHUTDOWN_TIMEOUT_MS);
          void (async () => {
            try {
              await c.stop?.();
              // stop 后同步 AgentTracker——任务不再被调度
              if (this._agentTracker && componentPhase) {
                this._agentTracker.syncLifecycleState(name, 'stop');
              }
              c.dispose?.();
              // dispose 后同步 AgentTracker——强制标记为 failed
              if (this._agentTracker && componentPhase) {
                this._agentTracker.syncLifecycleState(name, 'dispose');
              }
            } catch (err) {
              // 组件自身异常 → 上报并跳过（不阻塞后续组件）
              this._emitComponentError(name, err);
            } finally {
              clearTimeout(timeoutId);
              resolve(false);
            }
          })();
        });
        if (timedOut) {
          this._emitComponentError(name, new Error(`[ShutdownOrchestrator] shutdown timeout: ${name}（超时后跳过，后台任务由进程退出路径收尾）`));
        }
      } catch (err) {
        this._emitComponentError(name, err);
      }
    }
  }

  /** 注入 AgentTracker——生命周期关闭时同步状态 */
  setAgentTracker(tracker: AgentTrackerLike): void {
    this._agentTracker = tracker;
  }

  /** 发射组件关闭失败事件到 PipelineObserver */
  private _emitComponentError(name: string, err: unknown): void {
    if (!this._observer) return;
    const event = {
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
    } as const;
    this._observer.emit(event);
  }
}
