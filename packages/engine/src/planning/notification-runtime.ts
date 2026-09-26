// ============================================================
// @cortex/engine/planning/notification-runtime —— 通知运行时接入
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
import type {
  NotificationPipe} from "@cortex/notification";
import {
  type NotificationEvent,
  NotificationChannel,
  withSemantics,
  type NotificationSemantics,
} from "@cortex/notification";
import { recordTelemetry } from "@cortex/telemetry";
import type { ZeroTokenValidator } from "../execution/zero-token-validator.js";

/**
 * 通知运行时配置。
 */
export interface NotificationRuntimeOptions {
  /** 事件类型 → 通知语义映射 */
  eventSemantics?: Partial<Record<PipelineEventType | string, NotificationSemantics>>;
  /** 是否启用遥测，默认 true */
  enableTelemetry?: boolean;
  /** 零 token 校验器——用于对治理事件标记来源并降级 llm-inference 通知 */
  governanceValidator?: ZeroTokenValidator;
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
  /** 已推送通知计数（真实计数——修复遥测硬编码 0 的假信号） */
  private _sentCount = 0;

  /** 默认语义映射 */
  private readonly defaultSemantics: Partial<Record<string, NotificationSemantics>> = {
    [PipelineEventType.SchedulerLoopCrashed]: "DECISION_REQUIRED",
    [PipelineEventType.ErrorReported]: "WARNING",
    [PipelineEventType.ErrorSilentUpgraded]: "WARNING",
    [PipelineEventType.AgentPoolInvariantViolation]: "WARNING",
    [PipelineEventType.NodeComplete]: "FYI",
    [PipelineEventType.NodeFailed]: "WARNING",
    [PipelineEventType.SchedulerDone]: "FYI",
    // S2-4：记忆持久化失败不静默——升为 WARNING（Important 通道）
    [PipelineEventType.MemoryPersistFailed]: "WARNING",
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
    this._sentCount = 0;

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

  /** 治理事件类型列表 */
  private static readonly GOVERNANCE_EVENT_TYPES = [
    PipelineEventType.ConstitutionViolation,
    PipelineEventType.GovernanceAmendmentProposed,
    PipelineEventType.GovernanceAuditReport,
    PipelineEventType.GovernanceComplianceViolation,
    PipelineEventType.GovernanceRoundtableConsensus,
  ];

  // ── 归并策略（R13-D2）──────────────────────────────
  //
  // 归并的「窗口 / 批次」是运营参数，配在 config 的 event-routing.json.mergeRules；
  // 而「哪些事件参与归并」是语义判断——它和 defaultSemantics 是同一类知识，
  // 所以留在运行时里，两处不重复配置。
  //
  // 判据：故障期会以「同源、同类」形式每秒重复数百至数千次的事件。
  // 逐条投递没有信息增量，只会把持久化层撑爆（实测 963 万条 / 1.97 GB）。
  // 决策类事件（DECISION_REQUIRED）永不在此列——每一条都必须单独可见。

  /** 参与归并的高频告警事件类型 */
  private static readonly MERGEABLE_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
    PipelineEventType.ErrorReported,
    PipelineEventType.ErrorSilentUpgraded,
    PipelineEventType.NodeFailed,
    PipelineEventType.AgentPoolInvariantViolation,
  ]);

  /** 错误指纹的最大保留长度——只需区分错误类别，不需要完整正文 */
  private static readonly FINGERPRINT_MAX_LENGTH = 120;

  /**
   * 错误指纹——抹掉每次都会变的部分，只留**消息形状**。
   *
   * 崩溃循环里同一条错误每次携带的行号 / 计数 / 请求 id 都不同，
   * 只有抹掉它们，归并键才会收敛。
   *
   * 边界（刻意如此）：这是形状归一化，不是语义分类器。同一条故障换了措辞
   * 就会被算作两个键——宁可少合并，也不把不同故障揉成一条。真正兜底的是
   * NotificationPipe 的缓冲键数上限，不是这里的智能程度。
   */
  private static fingerprint(text: string): string {
    return text
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
      .replace(/\b[0-9a-f]{7,}\b/gi, "<hex>")
      .replace(/\d+/g, "<n>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, NotificationRuntime.FINGERPRINT_MAX_LENGTH);
  }

  /**
   * 计算归并键——不参与归并的事件返回 undefined（逐条投递）。
   *
   * 键 = 事件类型 + 来源标识 + 错误指纹。这样：
   *   - 同一个源反复报同一类错 → 归并成一条「[归并] N 条 … 事件」
   *   - 不同源、或同类源的不同错误 → 保持独立，不丢信息
   */
  private _mergeKeyFor(eventType: string, payload: Record<string, unknown>): string | undefined {
    if (!NotificationRuntime.MERGEABLE_EVENT_TYPES.has(eventType)) return undefined;
    const source = String(payload.nodeId ?? payload.source ?? payload.sourceAgent ?? "unknown");
    const detail = String(payload.error ?? payload.reason ?? payload.message ?? "");
    return `${eventType}|${source}|${NotificationRuntime.fingerprint(detail)}`;
  }

  /**
   * 处理事件——转换为通知并发送到 NotificationPipe。
   *
   * llm-inference 来源的治理事件自动降级语义：
   *   DECISION_REQUIRED → WARNING
   *   WARNING → FYI
   */
  /** 治理事件走零 token 规则验证——llm-inference 来源降级语义 */
  private _downgradeIfLlmInference(event: ObservableEvent, semantics: NotificationSemantics): NotificationSemantics {
    if (!this.options.governanceValidator) return semantics;
    if (!NotificationRuntime.GOVERNANCE_EVENT_TYPES.includes(event.type)) return semantics;

    const result = this.options.governanceValidator.validate(event, { workspaceRoot: process.cwd() });
    if (result.source === "llm-inference") {
      // 降级：DECISION_REQUIRED → WARNING, WARNING → FYI
      if (semantics === "DECISION_REQUIRED") return "WARNING";
      if (semantics === "WARNING") return "FYI";
    }
    return semantics;
  }

  private _handleEvent(event: ObservableEvent): void {
    const rawSemantics = this._resolveSemantics(event.type as string);
    const semantics = this._downgradeIfLlmInference(event, rawSemantics);
    const notification = this._eventToNotification(event, semantics);

    if (!notification) return;

    // 发送到通知管线
    try {
      this.notificationPipe.push(notification);
      this._sentCount += 1;
    } catch (e: unknown) {
      this.observer.emit({
        type: PipelineEventType.ErrorReported,
        priority: PipelinePriority.NORMAL,
        payload: { source: "NotificationRuntime", severity: "warn", error: `发送通知失败: ${String(e).slice(0, 200)}` },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    }

    // 遥测——真实计数（此前硬编码 0：指标与行为脱钩的假信号）
    if (this.options.enableTelemetry !== false) {
      void recordTelemetry("notification.runtime.sent", this._sentCount, [
        { key: "eventType", value: event.type as string },
        { key: "semantics", value: semantics },
        { key: "channel", value: notification.channel },
      ]).catch(err => console.error(`[notification] runtime telemetry failed: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  /**
   * 解析事件语义——确定事件的语义层级。
   */
  private _resolveSemantics(eventType: string): NotificationSemantics {
    // 优先使用用户配置
    if (this.options.eventSemantics?.[eventType]) {
      return this.options.eventSemantics[eventType] ?? "FYI";
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
      // R13-D2：此前从不设置 mergeKey，NotificationPipe 的归并分支永不进入
      mergeKey: this._mergeKeyFor(event.type as string, payload),
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
