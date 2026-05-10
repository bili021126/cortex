import type { ObservableEvent, PipelineHandler, SafeErrorReporter, SafeErrorContext } from "@cortex/shared";
import { PipelinePriority } from "@cortex/shared";

/**
 * handler 异常上报回调签名。
 * 默认降级到 `console.error`。外部可注入 Sentry/Datadog/事件总线等任意后端。
 */
export interface HandlerErrorContext {
  eventType: string;
  priority: PipelinePriority;
  error: unknown;
  handlerIndex: number; // 异常发生在同优先级第几个 handler 上
}

export type HandlerErrorReporter = (ctx: HandlerErrorContext) => void;

/**
 * PipelineObserver —— 可观测事件管道（优先级回调注册表）
 * 替代 v1.1 的 EventBus。所有可观测事件走此管道。
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

  /** 移除某优先级下所有 handler */
  off(priority: PipelinePriority): void {
    this.handlers.delete(priority);
  }

  // ── 私有：SafeErrorReporter 实现 ─────────────────

  private _reportError(ctx: SafeErrorContext): void {
    if (ctx.severity === "silent") {
      const count = (this._silentCounters.get(ctx.source) ?? 0) + 1;
      this._silentCounters.set(ctx.source, count);
      if (count >= PipelineObserver.SILENT_UPGRADE_THRESHOLD) {
        this._silentCounters.delete(ctx.source);
        this.emit({
          type: "error.silent_upgraded",
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
      type: "error.reported",
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
