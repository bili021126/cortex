/**
 * @cortex/plugin-runner — PluginRunner 沙箱执行引擎
 *
 * 提供插件的安全执行环境，核心职责：
 *
 * 1. **执行前合规校验** — 校验插件存在性、Schema 配置校验、依赖存在性检查
 * 2. **异常隔离** — try/catch 包裹每个插件调用，单插件崩溃不抛到上层
 * 3. **超时切断** — Promise.race + AbortSignal，超时后标记插件状态为 error
 * 4. **资源清理** — 执行后调用 destroy()、清理工作目录、更新状态统计
 * 5. **拓扑排序执行** — executeAll() 按依赖顺序分批执行（同批并行，批次串行）
 *
 * @module
 */

import { rm } from "node:fs/promises";

import type {
  PluginConfig,
  ExecuteContext,
  PluginResult,
  PluginStatus,
  ExecutionReport,
} from "./types.js";
import type { PluginRegistry } from "./registry.js";
import type { PluginValidator } from "./validator.js";

// ── 配置接口 ──

/**
 * RunnerOptions —— PluginRunner 构造选项。
 */
export interface RunnerOptions {
  /** 默认超时时间 ms（默认 30000） */
  timeout?: number;
}

// ── PluginRunner 类 ──

/**
 * PluginRunner —— 沙箱执行引擎。
 *
 * 管理二级插件的安全执行，提供执行前校验、异常隔离、超时切断、资源清理。
 *
 * 使用方式：
 * ```ts
 * const runner = new PluginRunner(registry, validator, { timeout: 10000 });
 * const result = await runner.execute("myPlugin", {
 *   payload: { foo: "bar" },
 *   deps: new Map(),
 *   workDir: "/tmp/work",
 * });
 * ```
 *
 * @template T — 执行结果的 output 类型
 */
export class PluginRunner {
  /** 插件注册表引用 */
  private _registry: PluginRegistry;

  /** Schema 校验器引用 */
  private _validator: PluginValidator;

  /** 默认超时时间 (ms) */
  private _defaultTimeout: number;

  /** 运行时状态追踪映射 */
  private _statuses: Map<string, PluginStatus> = new Map();

  /** 由本运行器创建的临时工作目录集合（shutdown 时统一清理） */
  private _ownedWorkDirs: Set<string> = new Set();

  /**
   * @param registry — 插件注册表实例
   * @param validator — Schema 校验器实例
   * @param opts — 可选配置（超时等）
   */
  constructor(
    registry: PluginRegistry,
    validator: PluginValidator,
    opts?: RunnerOptions,
  ) {
    this._registry = registry;
    this._validator = validator;
    this._defaultTimeout = opts?.timeout ?? 30_000;
  }

  // ── 公开 API ──

  /**
   * 执行指定名称的插件。
   *
   * 完整执行流程：
   * ```
   * ┌─ 合规校验 ─────────────────────────────┐
   * │ ① 插件存在性检查                         │
   * │ ② Schema 配置校验（通过 PluginValidator） │
   * │ ③ 依赖存在性检查                         │
   * └──────────────────────────────────────────┘
   *          │ 通过
   *          ▼
   * ┌─ 执行阶段 ─────────────────────────────┐
   * │ ④ plugin.init(config)                  │
   * │ ⑤ plugin.execute(ctx)  ← 超时控制     │
   * │ ⑥ plugin.destroy()                     │
   * └──────────────────────────────────────────┘
   *          │
   *          ▼
   * ┌─ 收尾阶段 ─────────────────────────────┐
   * │ ⑦ 更新状态统计                          │
   * │ ⑧ 返回 PluginResult                    │
   * └──────────────────────────────────────────┘
   * ```
   *
   * 任意阶段抛出异常均被 try/catch 捕获，不会传播到调用方。
   *
   * @param name — 要执行的插件名称（需已注册到 registry）
   * @param ctx  — 执行上下文（payload、deps、workDir、timeoutMs、signal）
   * @returns PluginResult — 标准化执行结果
   */
  async execute<T = unknown>(
    name: string,
    ctx: ExecuteContext,
  ): Promise<PluginResult<T>> {
    const startTime = Date.now();

    // ──── 阶段①: 合规校验 ────

    // 1-a. 插件存在性检查
    const plugin = this._registry.get(name);
    if (!plugin) {
      return {
        success: false,
        error: `[PluginRunner] 插件 "${name}" 未注册`,
        durationMs: Date.now() - startTime,
      };
    }

    // 1-b. Schema 配置校验（无 schema 时静默通过）
    const defaultConfig: PluginConfig = { enabled: true };
    const configResult = this._validator.validateConfig(name, defaultConfig);
    if (!configResult.valid) {
      return {
        success: false,
        error: `[PluginRunner] 配置校验失败: ${configResult.errors.join("; ")}`,
        durationMs: Date.now() - startTime,
      };
    }

    // 1-c. 依赖存在性检查
    for (const depName of plugin.dependencies) {
      if (!this._registry.has(depName)) {
        return {
          success: false,
          error: `[PluginRunner] 依赖插件 "${depName}" 未注册`,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // ──── 阶段②: 执行阶段（异常隔离） ────

    // 更新状态 → running
    this._updateStatus(name, "running");

    try {
      // 2-a. 初始化插件
      await plugin.init(defaultConfig);
      this._updateStatus(name, "initialized");

      // 2-b. 超时执行
      const timeoutMs = ctx.timeoutMs ?? this._defaultTimeout;
      await this._withTimeout(plugin.execute(ctx), timeoutMs, ctx.signal);

      // 2-c. 读取出产出
      const output = ctx.output as T | undefined;

      // 2-d. 销毁插件（清理内部资源）
      await plugin.destroy();

      // ──── 阶段③: 收尾 ────
      this._updateStatus(name, "destroyed");

      return {
        success: true,
        output,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      // ⚠️ 异常隔离：任何阶段的异常均在此捕获，不抛到上层

      const errorMessage = err instanceof Error ? err.message : String(err);

      // 尝试销毁插件（即使执行失败也要清理资源）
      try {
        await plugin.destroy();
      } catch {
        // 销毁失败不影响主流程——静默忽略
      }

      // 更新状态 → error
      this._updateStatus(name, "error", errorMessage);

      return {
        success: false,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 批量执行所有已注册的插件。
   *
   * 执行策略：
   * - 调用 `registry.resolveDependencies()` 获取拓扑排序批次
   * - **同批次**内插件无相互依赖，**并行**执行
   * - **批次间**必须串行（前一批全部完成后再执行下一批）
   * - 单个插件的失败不会影响同批次其他插件的执行
   *
   * @param ctx — 执行上下文（所有插件共享）
   * @returns ExecutionReport — 批量执行报告
   */
  async executeAll(ctx: ExecuteContext): Promise<ExecutionReport> {
    const startTime = Date.now();
    const results = new Map<string, PluginResult>();

    // 获取拓扑排序批次
    const batches = this._registry.resolveDependencies();

    for (const batch of batches) {
      // 同批次内插件并行执行
      const batchResults = await Promise.allSettled(
        batch.map((plugin) => this.execute(plugin.name, ctx)),
      );

      // 收集结果
      for (let i = 0; i < batch.length; i++) {
        const pluginName = batch[i].name;
        const settled = batchResults[i];

        if (settled.status === "fulfilled") {
          results.set(pluginName, settled.value);
        } else {
          // Promise.allSettled 理论上不会走到 rejected 分支，
          // 因为 execute() 自身 catch 了所有异常。
          // 此处作为防御式兜底。
          const reason = settled.reason;
          results.set(pluginName, {
            success: false,
            error: reason instanceof Error ? reason.message : String(reason),
            durationMs: Date.now() - startTime,
          });
        }
      }
    }

    const allResults = Array.from(results.values());
    const succeeded = allResults.filter((r) => r.success).length;
    const failed = allResults.filter((r) => !r.success).length;

    return {
      total: allResults.length,
      succeeded,
      failed,
      results,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * 获取指定插件的运行时状态。
   *
   * @param name — 插件名称
   * @returns PluginStatus | undefined — 未执⾏过的插件返回 undefined
   */
  getStatus(name: string): PluginStatus | undefined {
    return this._statuses.get(name);
  }

  /**
   * 优雅关闭运行器。
   *
   * 执行以下清理操作：
   * 1. 调用所有已注册插件的 `destroy()`（异常隔离，逐个尝试）
   * 2. 清理本运行器创建的临时工作目录
   * 3. 清空运行时状态追踪
   */
  async shutdown(): Promise<void> {
    // 1. 销毁所有已注册插件
    const allPlugins = this._registry.getAll();
    await Promise.allSettled(allPlugins.map((p) => p.destroy()));

    // 2. 清理本运行器创建的临时工作目录
    const cleanupTasks: Promise<void>[] = [];
    for (const dir of this._ownedWorkDirs) {
      cleanupTasks.push(
        rm(dir, { recursive: true, force: true }).catch(() => {
          // 单个目录清理失败 — 静默忽略
        }),
      );
    }
    await Promise.allSettled(cleanupTasks);
    this._ownedWorkDirs.clear();

    // 3. 清空状态追踪
    this._statuses.clear();
  }

  // ── 内部方法 ──

  /**
   * 超时控制。
   *
   * 使用 Promise.race 实现超时切断。若超时发生，返回的 Promise 会 reject
   * 并附带超时错误信息。
   *
   * 支持外部 AbortSignal：若外部 signal 先触发，则以取消错误优先返回。
   *
   * @param promise — 要执行的异步操作
   * @param ms — 超时时间（毫秒）
   * @param signal — 外部中止信号（可选）
   * @returns 原始 Promise 的 resolve 值
   */
  private _withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    signal?: AbortSignal,
  ): Promise<T> {
    // 若 ms ≤ 0，直接返回原始 promise（不设超时）
    if (ms <= 0) {
      return promise;
    }

    const controller = new AbortController();

    // 合并外部 signal 和内部 controller
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        controller.abort();
        reject(new Error(`[PluginRunner] 执行超时 (${ms}ms)`));
      }, ms);

      // 监听中止信号（外部取消或超时取消）
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("[PluginRunner] 已通过 AbortSignal 取消"));
      };

      if (combinedSignal.aborted) {
        onAbort();
        return;
      }

      combinedSignal.addEventListener("abort", onAbort, { once: true });

      // 原始 promise 完成
      promise.then(
        (val) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          combinedSignal.removeEventListener("abort", onAbort);
          resolve(val);
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          combinedSignal.removeEventListener("abort", onAbort);
          reject(err);
        },
      );
    });
  }

  /**
   * 更新插件的运行时状态。
   *
   * 维护 `_statuses` 映射，统计执行次数、失败次数、最近错误等。
   *
   * @param name — 插件名称
   * @param phase — 当前生命周期阶段
   * @param lastError — 最近错误信息（phase="error" 时必填）
   */
  private _updateStatus(
    name: string,
    phase: PluginStatus["phase"],
    lastError?: string,
  ): void {
    const current = this._statuses.get(name);
    const now = Date.now();

    const newStatus: PluginStatus = {
      name,
      phase,
      lastExecutedAt:
        phase === "running" || phase === "initialized"
          ? now
          : current?.lastExecutedAt,
      executionCount:
        (current?.executionCount ?? 0) + (phase === "running" ? 1 : 0),
      failureCount:
        (current?.failureCount ?? 0) + (phase === "error" ? 1 : 0),
      lastError,
      healthy: phase !== "error",
    };

    this._statuses.set(name, newStatus);
  }
}
