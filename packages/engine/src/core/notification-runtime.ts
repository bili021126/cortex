// ============================================================
// @cortex/engine/core/notification-runtime —— 通知运行时接入
//
// @layer 治理层
// @role 观察者——事件转换，不决策
//
// 职责：
//   将 PipelineObserver 的事件流桥接到 NotificationPipe，
//   实现事件 → 通知的自动转换和路由。
//
// 设计原则：
//   1. 桥接而非耦合——PipelineObserver 和 NotificationPipe 各自独立
//   2. 路由表驱动——哪些事件转通知、发到哪个通道，由路由表配置
//   3. 语义增强——自动附加 FYI/WARNING/DECISION_REQUIRED 语义标注
// ============================================================

import { PipelineEventType, PipelinePriority, type IPipelineObserver, type ObservableEvent, type PipelineHandler } from "@cortex/shared";
import {
  NotificationPipe,
  RouteTable,
  type NotificationEvent,
  type NotificationHandler,
  NotificationChannel,
  withSemantics,
  type NotificationSemantics,
} from "@cortex/notification";
import { recordTelemetry } from "@cortex/telemetry";

/**
 * 通知运行时配置。
 */
export interface NotificationRuntimeOptions {
  /** 事件类型 → 通知语义映射 */
  eventSemantics?: Partial<Record<PipelineEventType | string, NotificationSemantics>>;
  /** 是否启用遥测，默认 true */
  enableTelemetry?: boolean;
}

/**
 * 通知运行时——连接 PipelineObserver 和 NotificationPipe。
 *
 * 典型用法：
 *   ```typescript
 *   const runtime = new NotificationRuntime(observer, notificationPipe, {
 *     eventSemantics: {
 *       [PipelineEventType.SchedulerLoopCrashed]: "DECISION_REQUIRED",
 *       [PipelineEventType.ErrorReported]: "WARNING",
 *       [PipelineEventType.NodeComplete]: "FYI",
 *     },
 *   });
 *   runtime.start();
 *   ```
 */
export class NotificationRuntime {
  private _started = false;
  private _handler?: PipelineHandler;

  /** 默认语义映射 */
  private readonly defaultSemantics: Partial<Record<string, NotificationSemantics>> = {
    [PipelineEventType.SchedulerLoopCrashed]: "DECISION_REQUIRED",
    [PipelineEventType.ErrorReported]: "WARNING",
    [PipelineEventType.ErrorSilentUpgraded]: "WARNING",
    [PipelineEventType.AgentPoolInvariantViolation]: "WARNING",
    [PipelineEventType.NodeComplete]: "FYI",
    [PipelineEventType.NodeFailed]: "WARNING",
    [PipelineEventType.SchedulerDone]: "FYI",
  };

  constructor(
    private readonly observer: IPipelineObserver,
    private readonly notificationPipe: NotificationPipe,
    private readonly options: NotificationRuntimeOptions = {},
  ) {}

  /**
   * 启动运行时——订阅 PipelineObserver 事件并转发到 NotificationPipe。
   */
  start(): void {
    if (this._started) return;
    this._started = true;

    this._handler = (event: ObservableEvent) => {
      this._handleEvent(event);
    };

    // 订阅所有优先级（CRITICAL + HIGH + NORMAL）
    this.observer.on(PipelinePriority.CRITICAL, this._handler);
    this.observer.on(PipelinePriority.HIGH, this._handler);
    this.observer.on(PipelinePriority.NORMAL, this._handler);
  }

  /**
   * 停止运行时。
   */
  stop(): void {
    if (!this._started || !this._handler) return;
    this._started = false;

    this.observer.off(PipelinePriority.CRITICAL, this._handler);
    this.observer.off(PipelinePriority.HIGH, this._handler);
    this.observer.off(PipelinePriority.NORMAL, this._handler);
  }

  /**
   * 处理事件——转换为通知并发送到 NotificationPipe。
   */
  private _handleEvent(event: ObservableEvent): void {
    const semantics = this._resolveSemantics(event.type as string);
    const notification = this._eventToNotification(event, semantics);

    if (!notification) return;

    // 发送到通知管线
    try {
      this.notificationPipe.push(notification);
    } catch (e: unknown) {
      console.warn(`[NotificationRuntime] 发送通知失败: ${String(e).slice(0, 200)}`);
    }

    // 遥测
    if (this.options.enableTelemetry !== false) {
      void recordTelemetry("notification.runtime.sent", 0, [
        { key: "eventType", value: event.type as string },
        { key: "semantics", value: semantics },
        { key: "channel", value: notification.channel },
      ]);
    }
  }

  /**
   * 解析事件语义——确定事件的语义层级。
   */
  private _resolveSemantics(eventType: string): NotificationSemantics {
    // 优先使用用户配置
    if (this.options.eventSemantics?.[eventType as PipelineEventType]) {
      return this.options.eventSemantics[eventType as PipelineEventType]!;
    }
    // 回退到默认映射
    return this.defaultSemantics[eventType] ?? "FYI";
  }

  /**
   * 事件转通知——将 ObservableEvent 转换为 NotificationEvent。
   */
  private _eventToNotification(
    event: ObservableEvent,
    semantics: NotificationSemantics,
  ): NotificationEvent | null {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload) return null;

    // 根据语义确定通道和 ack 设置
    const channel = semantics === "DECISION_REQUIRED"
      ? NotificationChannel.Urgent
      : semantics === "WARNING"
        ? NotificationChannel.Important
        : NotificationChannel.Routine;

    const ackRequired = semantics === "DECISION_REQUIRED";

    const baseEvent: NotificationEvent = {
      type: event.type as string,
      channel,
      ackRequired,
      requestId: event.requestId ?? `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      summary: this._extractSummary(event.type as string, payload),
      detail: this._extractDetail(payload),
      sourceAgent: payload.sourceAgent as string | undefined,
      timestamp: event.timestamp ?? Date.now(),
    };

    // 附加语义标注
    return withSemantics(baseEvent, semantics);
  }

  /**
   * 提取摘要——从 payload 中提取人类可读的摘要。
   */
  private _extractSummary(eventType: string, payload: Record<string, unknown>): string {
    if (payload.summary) return String(payload.summary);
    if (payload.error) return `错误: ${String(payload.error).slice(0, 100)}`;
    if (payload.source) return `${eventType}: ${String(payload.source)}`;
    return eventType;
  }

  /**
   * 提取详情——从 payload 中提取详细信息。
   */
  private _extractDetail(payload: Record<string, unknown>): string | undefined {
    if (payload.detail) return String(payload.detail);
    if (payload.hint) return String(payload.hint);
    return undefined;
  }
}
