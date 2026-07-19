import { PipelineEventType, PipelinePriority, type EmitMeta, type EmittableEvent, type HandlerErrorContext, type HandlerErrorReporter, type IPipelineObserver, type PipelineHandler, type SafeErrorContext, type SafeErrorReporter, } from "@cortex/shared";

/** 保存原始 console.error 引用，规避 console-bridge 拦截导致的二次递归 */
const _origConsoleError = console.error;

/**
 * PipelineObserver —— 可观测事件管道（优先级回调注册表）
 * 替代 v1.1 的 EventBus。所有可观测事件走此管道。
 *
 * @fix D4 — off() 支持按 handler 引用精确移除，避免误删其他组件的 handler。
 * @fix N-01 — _reportError 防递归计数器（允许最多 3 层嵌套），防止 handler 异常 → emit → handler 异常 → 栈溢出。
 */
export class PipelineObserver implements IPipelineObserver {
  private handlers = new Map<PipelinePriority, PipelineHandler[]>();
  private _onHandlerError: HandlerErrorReporter | null = null;
  /** silent 错误连续发生计数器：source → 连续次数 */
  private _silentCounters = new Map<string, number>();
  private static readonly SILENT_UPGRADE_THRESHOLD = 3;
  /** @fix N-01 — 递归深度上限：0=空闲，≥MAX 时丢弃，防止无限 e→handler 崩→e→handler 崩… */
  private _reentrancyDepth = 0;
  private static readonly MAX_REENTRANCY_DEPTH = 3;
  /** 遥测：事件发射累计计数 */
  private _eventCount = 0;

  // ── 死信环形缓冲区 ────────────────────────

  /**
   * 死信队列——被 DegradationBoundary silent 吞掉的事件记录。
   * 环形缓冲，满时覆盖最老条目。
   * 不写磁盘，进程重启清空。
   */
  private deadLetterRing: Array<{ id: string; type: string; timestamp: number; spanId?: string }> = [];
  private deadLetterIndex = 0;
  private static readonly DEAD_LETTER_MAX = 1000;

  /**
   * 将事件写入死信队列。
   * 由外部 DegradationBoundary 在 silent 吞掉事件时调用。
   */
  recordDeadLetter(id: string, type: string, timestamp: number, spanId?: string): void {
    if (this.deadLetterRing.length < PipelineObserver.DEAD_LETTER_MAX) {
      this.deadLetterRing.push({ id, type, timestamp, spanId });
    } else {
      // 环形覆盖最老条目
      this.deadLetterRing[this.deadLetterIndex % PipelineObserver.DEAD_LETTER_MAX] = { id, type, timestamp, spanId };
      this.deadLetterIndex++;
    }
  }

  /**
   * 注入 handler 异常上报后端。
   * 不注入则默认 `console.error`。
   *
   * 扩展入口：日后接入 Sentry/Datadog/故障聚合器时，只需替换此回调。
   */
  onHandlerError(reporter: HandlerErrorReporter | null): void {
    this._onHandlerError = reporter;
  }

  /** 注册回调。同优先级按注册顺序执行。超过上限时 warn 但不停。 */
  on(priority: PipelinePriority, handler: PipelineHandler): void {
    if (!this.handlers.has(priority)) {
      this.handlers.set(priority, []);
    }
    const handlers = this.handlers.get(priority);
    if (handlers) {
      if (handlers.length >= 50) {
        console.warn(`[PipelineObserver] handler count at ${handlers.length} for priority ${priority} — possible leak`);
      }
      handlers.push(handler);
    }
  }

  /**
   * 发射事件。只调用与事件优先级匹配的 handler。
   *
   * 订阅者按宪法约定：
   *   Sentinel   → CRITICAL + HIGH
   *   MemoryStore → ALL (CRITICAL + HIGH + NORMAL)
   *   管家        → HIGH + NORMAL
   *
   * 单 handler 异常不阻断后续 handler（隔离设计）。
   */
  emit(event: EmittableEvent, meta?: EmitMeta): void {
    // 遥测：事件吞吐计数
    this._eventCount++;
    if (this._eventCount % 100 === 0) {
      console.error(`[telemetry] observer.event_throughput count=${this._eventCount}`);
    }
    // 非 silent emit：检查死信队列中是否有当前 span 的上游事件
    if (meta?.causalChain?.spanId) {
      const upstreamFromDeadLetter = this._findUpstreamInDeadLetter(meta.causalChain.spanId);
      if (upstreamFromDeadLetter.length > 0) {
        if (!meta.causalChain.upstreamEvents) {
          meta.causalChain.upstreamEvents = [];
        }
        for (const entry of upstreamFromDeadLetter) {
          const deadLetterId = `deadLetter:${entry.id}`;
          if (!meta.causalChain.upstreamEvents.includes(deadLetterId)) {
            meta.causalChain.upstreamEvents.push(deadLetterId);
          }
        }
      }
    }

    // 幂等键：每次 emit 自动生成 requestId
    if (!event.requestId) {
      event.requestId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    const handlers = this.handlers.get(event.priority);
    if (handlers) {
      for (let i = 0; i < handlers.length; i++) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          handlers[i]!(event);
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
            this._reportError({
              source: `PipelineObserver.handler[${i}]`,
              severity: "degraded",
              error: ctx.error,
              hint: `handler error on event=${ctx.eventType} priority=${PipelinePriority[ctx.priority]}`,
            }, meta?.causalChain?.spanId);
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
   * @fix D4 — 支持按 handler 引用精确移除。
   */
  off(priority: PipelinePriority, handler?: PipelineHandler): void {
    if (handler === undefined) {
      this.handlers.delete(priority);
      return;
    }

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

  private _reportError(ctx: SafeErrorContext, spanId?: string): void {
    if (this._reentrancyDepth >= PipelineObserver.MAX_REENTRANCY_DEPTH) {
      _origConsoleError("[PipelineObserver] _reportError 递归深度超限(≥" + PipelineObserver.MAX_REENTRANCY_DEPTH + ")，丢弃:",
        ctx.source, String(ctx.error).slice(0, 200));
      return;
    }
    this._reentrancyDepth++;
    try {
      if (ctx.severity === "silent") {
        const count = (this._silentCounters.get(ctx.source) ?? 0) + 1;
        this._silentCounters.set(ctx.source, count);
        // 记录到死信队列
        this.recordDeadLetter(
          `silent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          `silent:${ctx.source}`,
          Date.now(),
          spanId,
        );
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
    } finally {
      this._reentrancyDepth--;
    }
  }

  // ── 私有：死信查询 ──────────────────────────

  /**
   * 在死信队列中查找与给定 spanId 相关的事件。
   * 匹配规则：死信条目的 type 中包含 spanId 或其关联前缀。
   */
  private _findUpstreamInDeadLetter(spanId: string): Array<{ id: string; type: string; timestamp: number; spanId?: string }> {
    // 只扫描最近的条目（环形缓冲当前有效长度内）
    const results: Array<{ id: string; type: string; timestamp: number; spanId?: string }> = [];
    for (const entry of this.deadLetterRing) {
      if (entry.spanId === spanId) {
        results.push(entry);
      }
    }
    return results;
  }
}
