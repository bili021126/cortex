/**
 * shared/lifecycle.ts — 标准组件生命周期接口
 *
 * 定义所有引擎组件的统一生命周期契约。
 * ILifecycle 是 Engine 容器编排的基础抽象——
 * 所有插件、组件、服务均需实现此接口以参与统一的 init→start→stop→dispose 流程。
 *
 * 生命周期单向流转：
 *   Created → init() → Running → stop() → Stopped → dispose() → Disposed
 *
 * @module shared/lifecycle
 * @since v1.0 — ILifecycle 最早期基础抽象
 * @since v3.x — 全系统重构：注释标准化、语义明确化
 * @constitutional §9.1 — 所有可管理生命周期的组件必须实现 ILifecycle
 */

/** 生命周期阶段——严格单向流转，不可回溯 */
export enum LifecyclePhase {
  /** 初始状态：组件已构造但未初始化 */
  Created = "Created",
  /** 初始化中：init() 正在执行 */
  Initializing = "Initializing",
  /** 运行中：组件正常工作 */
  Running = "Running",
  /** 停止中：stop() 正在执行 */
  Stopping = "Stopping",
  /** 已停止：stop() 完成，资源已释放 */
  Stopped = "Stopped",
  /** 已销毁：dispose() 完成，不可再使用 */
  Disposed = "Disposed",
}

/**
 * 标准组件生命周期接口。
 * 所有可管理生命周期的组件（MemoryStore、Scheduler、FileLockManager 等）应实现此接口。
 *
 * 约定语义：
 * - init(): 初始化阶段——建立连接、加载配置、预热缓存。幂等，可重复调用。
 * - start(): 启动阶段——开始接收请求/任务。必须在 init() 之后调用。
 * - stop(): 优雅关闭——拒绝新请求，等待进行中任务完成。必须在 Running 态调用。
 * - dispose(): 立即释放——不等待，强行回收资源（文件句柄、定时器、网络连接）。不抛错，可重复调用。
 */
export interface ILifecycle {
  /** 当前生命周期阶段 */
  readonly phase: LifecyclePhase;

  /** 初始化：分配资源、建立连接。完成后 phase 应变为 Running。 */
  init(): Promise<void>;

  /** 启动：开始接受外部请求或启动后台任务。调用前必须已 init() 完成。 */
  start(): Promise<void>;

  /**
   * 优雅关闭：完成进行中的工作，释放外部连接。
   * 完成后 phase 应变为 Stopped。
   * 应在有限时间内完成（默认 SHUTDOWN_TIMEOUT_MS）。
   */
  stop(): Promise<void>;

  /**
   * 立即释放资源：清理定时器、清空内存缓存。
   * 不抛错，可重复调用。调用后 phase 变为 Disposed。
   */
  dispose(): void;
}

/**
 * 基础生命周期实现——提供 phase 管理 + 状态校验。
 * 子类覆写 doInit/doStart/doStop/doDispose 实现具体逻辑。
 */
export abstract class BaseLifecycle implements ILifecycle {
  private _phase: LifecyclePhase = LifecyclePhase.Created;

  get phase(): LifecyclePhase {
    return this._phase;
  }

  async init(): Promise<void> {
    if (this._phase !== LifecyclePhase.Created) {
      throw new Error(`[BaseLifecycle] 无法 init: 当前 phase=${this._phase}，期望 Created`);
    }
    this._phase = LifecyclePhase.Initializing;
    await this.doInit();
    this._phase = LifecyclePhase.Running;
  }

  async start(): Promise<void> {
    if (this._phase !== LifecyclePhase.Running) {
      throw new Error(`[BaseLifecycle] 无法 start: 当前 phase=${this._phase}，期望 Running`);
    }
    await this.doStart();
  }

  async stop(): Promise<void> {
    if (this._phase !== LifecyclePhase.Running) return;
    this._phase = LifecyclePhase.Stopping;
    await this.doStop();
    this._phase = LifecyclePhase.Stopped;
  }

  dispose(): void {
    if (this._phase === LifecyclePhase.Disposed) return;
    try {
      this.doDispose();
    } catch {
      // dispose 不抛错——静默失败是契约的一部分
    }
    this._phase = LifecyclePhase.Disposed;
  }

  /** 子类覆写：初始化逻辑 */
  protected async doInit(): Promise<void> { /* no-op */ }

  /** 子类覆写：启动逻辑 */
  protected async doStart(): Promise<void> { /* no-op */ }

  /** 子类覆写：优雅关闭逻辑 */
  protected async doStop(): Promise<void> { /* no-op */ }

  /** 子类覆写：立即释放资源 */
  protected doDispose(): void { /* no-op */ }
}
