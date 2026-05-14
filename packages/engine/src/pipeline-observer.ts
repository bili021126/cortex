import type { ObservableEvent, PipelineHandler, SafeErrorReporter, SafeErrorContext, HandlerErrorContext, HandlerErrorReporter } from "@cortex/shared";
import { PipelineEventType, PipelinePriority } from "@cortex/shared";

// HandlerErrorContext + HandlerErrorReporter 已迁移至 @cortex/shared —— 从 shared import 即可
// 迁移原因（艾尔海森 P1）：PipelineObserver 的 handler 异常回调类型供外部注入自定义错误上报后端使用，
// 统一到 shared 中可避免外部代码自行推导类型。

/**
 * PipelineObserver —— 可观测事件管道（优先级回调注册表）
 * 替代 v1.1 的 EventBus。所有可观测事件走此管道。
 *
 * @fix D4 — off() 支持按 handler 引用精确移除，避免误删其他组件的 handler。
 */
export class PipelineObserver {
  private handlers = new Map<PipelinePriority, PipelineHandler[]>();
  private _onHandlerError: HandlerErrorReporter | null = null;
  /** silent 错误连续发生计数器：source → 连续次数 */
  private _silentCounters = new Map<string, number>();
  private static readonly SILENT_UPGRADE_THRESHOLD = 3;

  /**
   * 注入 handler 异常上报后端。
   * 不注入则默认 `console.error`。
   *
   * 扩展入口：日后接入 Sentry/Datadog/故障聚合器时，只需替换此回调。
   */
  onHandlerError(reporter: HandlerErrorReporter | null): void {
    this._onHandlerError = reporter;
  }

  /** 注册回调。同优先级按注册顺序执行。 */
  on(priority: PipelinePriority, handler: PipelineHandler): void {
    if (!this.handlers.has(priority)) {
      this.handlers.set(priority, []);
    }
    this.handlers.get(priority)!.push(handler);
  }

  /**
   * 发射事件。只调用与事件优先级匹配的 handler。
   * 如需接收多个优先级，订阅者需分别注册。
   *
   * 订阅者按宪法约定：
   *   Sentinel   → CRITICAL + HIGH
   *   MemoryStore → ALL (CRITICAL + HIGH + NORMAL)
   *   管家        → HIGH + NORMAL
   *
   * 单 handler 异常不阻断后续 handler（隔离设计）。
   * 异常通过 `_onHandlerError` 上报，不调用者透明。
   */
  emit(event: ObservableEvent): void {
    // 幂等键：每次 emit 自动生成 requestId（若调用方未提供）
    // 下游可用此字段区分"未上报"与"上报失败"，消除报警盲区
    if (!event.requestId) {
      event.requestId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    const handlers = this.handlers.get(event.priority);
    if (handlers) {
      for (let i = 0; i < handlers.length; i++) {
        try {
          handlers[i](event);
        } catch (e) {
          const ctx: HandlerErrorContext = {
            eventType: event.type,
            priority: event.priority,
            error: e,
            handlerIndex: i,
          };
          if (this._onHandlerError) {
            this._onHandlerError(ctx);
          } else {
            console.error(
              `[PipelineObserver] handler error (event=${ctx.eventType}, priority=${PipelinePriority[ctx.priority]}, index=${ctx.handlerIndex}): ${String(e).slice(0, 200)}`,
            );
          }
        }
      }
    }
  }

  /**
   * 创建 SafeErrorReporter 实例。
   *
   * silent 级别的错误连续发生 SILENT_UPGRADE_THRESHOLD 次后自动升级为 degraded，
   * 通过 observer 管道发射 `error.silent_upgraded` 事件。
   * 非 silent 错误立即重置该 source 的计数器。
   */
  createSafeReporter(): SafeErrorReporter {
    return (ctx: SafeErrorContext) => {
      this._reportError(ctx);
    };
  }

  /**
   * 移除某优先级下所有 handler，或仅移除指定的 handler。
   *
   * @param priority 优先级
   * @param handler 可选——指定要移除的 handler 引用；不传则移除该优先级下所有 handler
   *
   * @fix D4 — 支持按 handler 引用精确移除，避免 MemoryStoreMonitor.stop() 误删其他组件的 handler。
   */
  off(priority: PipelinePriority, handler?: PipelineHandler): void {
    if (handler === undefined) {
      // 移除该优先级下所有 handler（旧行为）
      this.handlers.delete(priority);
      return;
    }

    // 精确移除指定的 handler
    const existing = this.handlers.get(priority);
    if (existing) {
      const filtered = existing.filter((h) => h !== handler);
      if (filtered.length === 0) {
        this.handlers.delete(priority);
      } else {
        this.handlers.set(priority, filtered);
      }
    }
  }

  // ── 私有：SafeErrorReporter 实现 ─────────────────

  private _reportError(ctx: SafeErrorContext): void {
    if (ctx.severity === "silent") {
      const count = (this._silentCounters.get(ctx.source) ?? 0) + 1;
      this._silentCounters.set(ctx.source, count);
      if (count >= PipelineObserver.SILENT_UPGRADE_THRESHOLD) {
        this._silentCounters.delete(ctx.source);
        this.emit({
          type: PipelineEventType.ErrorSilentUpgraded,
          priority: PipelinePriority.HIGH,
          payload: {
            source: ctx.source,
            consecutive: count,
            threshold: PipelineObserver.SILENT_UPGRADE_THRESHOLD,
            lastError: String(ctx.error).slice(0, 300),
            hint: ctx.hint,
          },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      }
      return;
    }
    // 非 silent 错误：重置该 source 的计数器
    this._silentCounters.delete(ctx.source);

    const priority = ctx.severity === "fatal" ? PipelinePriority.CRITICAL : PipelinePriority.HIGH;
    this.emit({
      type: PipelineEventType.ErrorReported,
      priority,
      payload: {
        source: ctx.source,
        severity: ctx.severity,
        error: String(ctx.error).slice(0, 500),
        hint: ctx.hint,
      },
      timestamp: Date.now(),
      notificationType: "WARNING",
    });
  }
}
