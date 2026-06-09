/**
 * @cortex/plugin-runner — Plugin 接口实现 & 插件基类模块
 *
 * 定义 Plugin 接口的核心生命周期契约（init / execute / destroy），
 * 每个生命周期方法均返回 Promise<void>。
 *
 * 提供 AbstractPlugin 抽象基类，简化具体插件的实现。
 * 提供 isPlugin 类型守卫函数。
 */

import type { Plugin, PluginConfig, PluginHooks, ExecuteContext, PluginStatus } from "./types.js";

/**
 * AbstractPlugin —— 二级插件的抽象基类。
 *
 * 实现 Plugin 接口，提供默认行为模板。具体插件继承此类并复写
 * 必要的方法。
 *
 * 生命周期约定：
 *   1. init(config)   — 注入配置、初始化内部状态
 *   2. execute(ctx)   — 执行插件核心逻辑（可被多次调用）
 *   3. destroy()      — 优雅清理资源
 *
 * @template TConfig  — 插件配置类型
 */
export abstract class AbstractPlugin<TConfig = PluginConfig>
  implements Plugin<TConfig>
{
  /** 插件唯一名称（子类必须实现） */
  abstract readonly name: string;

  /** 插件版本号（默认 "1.0.0"） */
  readonly version: string = "1.0.0";

  /** 短描述（默认空） */
  readonly description: string = "";

  /** 依赖的二级插件名称列表 */
  readonly dependencies: string[] = [];

  /** 插件标签 */
  readonly tags: string[] = [];

  /** 支持的钩子声明 */
  readonly hooks: PluginHooks = {};

  /** 内部运行时状态（延迟初始化——避免在抽象属性赋值前访问 this.name） */
  private _status?: PluginStatus;

  /** 获取当前运行时状态 */
  get status(): PluginStatus {
    if (!this._status) {
      this._status = {
        name: this.name,
        phase: "created",
        executionCount: 0,
        failureCount: 0,
        healthy: true,
      };
    }
    return { ...this._status };
  }

  /** 更新内部状态 */
  protected setStatus(phase: PluginStatus["phase"], lastError?: string): void {
    const current = this.status;
    this._status = {
      name: this.name,
      phase,
      executionCount: current.executionCount + (phase === "running" ? 0 : 0),
      failureCount: current.failureCount + (phase === "error" ? 1 : 0),
      lastError,
      healthy: phase !== "error",
      lastExecutedAt: phase === "running" ? Date.now() : current.lastExecutedAt,
    };
  }

  /**
   * 初始化——注入配置，准备运行时状态。
   *
   * 子类可复写此方法添加自定义初始化逻辑（如建立数据库连接、读取配置文件）。
   * 默认实现仅将状态标记为 "initialized"。
   *
   * @param _config — 插件配置
   */
  async init(_config: TConfig): Promise<void> {
    this.setStatus("initialized");
  }

  /**
   * 执行核心逻辑。
   *
   * 子类必须复写此方法实现具体业务逻辑。
   * 执行结果应通过上下文（如事件桥接、共享状态）传递，
   * 或由 PluginRunner 在 execute 返回后自行收集。
   *
   * @param _context — 执行上下文（含 payload、依赖、工作目录等）
   */
  abstract execute(_context: ExecuteContext): Promise<void>;

  /**
   * 清理——释放资源。
   *
   * 子类可复写此方法添加自定义清理逻辑（如关闭连接、清除临时文件）。
   * 默认实现仅将状态标记为 "destroyed"。
   */
  async destroy(): Promise<void> {
    this.setStatus("destroyed");
  }
}

/**
 * isPlugin —— 类型守卫，判断一个未知对象是否实现了 Plugin 接口。
 *
 * 检测依据：对象非空、具有 string 类型的 name/version 属性，
 * 以及 init / execute / destroy 三个函数方法。
 */
export function isPlugin(obj: unknown): obj is Plugin {
  if (obj === null || obj === undefined) return false;
  if (typeof obj !== "object") return false;

  const candidate = obj as Record<string, unknown>;

  return (
    typeof candidate.name === "string" &&
    typeof candidate.version === "string" &&
    typeof candidate.execute === "function" &&
    typeof candidate.init === "function" &&
    typeof candidate.destroy === "function"
  );
}
