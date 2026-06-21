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
import { PipelineEventType, PipelinePriority } from "@cortex/shared";
import { NotificationChannel, withSemantics, } from "@cortex/notification";
import { recordTelemetry } from "@cortex/telemetry";
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
    observer;
    notificationPipe;
    options;
    _started = false;
    _handler;
    /** 默认语义映射 */
    defaultSemantics = {
        [PipelineEventType.SchedulerLoopCrashed]: "DECISION_REQUIRED",
        [PipelineEventType.ErrorReported]: "WARNING",
        [PipelineEventType.ErrorSilentUpgraded]: "WARNING",
        [PipelineEventType.AgentPoolInvariantViolation]: "WARNING",
        [PipelineEventType.NodeComplete]: "FYI",
        [PipelineEventType.NodeFailed]: "WARNING",
        [PipelineEventType.SchedulerDone]: "FYI",
    };
    constructor(observer, notificationPipe, options = {}) {
        this.observer = observer;
        this.notificationPipe = notificationPipe;
        this.options = options;
    }
    /**
     * 启动运行时——订阅 PipelineObserver 事件并转发到 NotificationPipe。
     */
    start() {
        if (this._started)
            return;
        this._started = true;
        this._handler = (event) => {
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
    stop() {
        if (!this._started || !this._handler)
            return;
        this._started = false;
        this.observer.off(PipelinePriority.CRITICAL, this._handler);
        this.observer.off(PipelinePriority.HIGH, this._handler);
        this.observer.off(PipelinePriority.NORMAL, this._handler);
    }
    /** 治理事件类型列表 */
    static GOVERNANCE_EVENT_TYPES = [
        PipelineEventType.ConstitutionViolation,
        PipelineEventType.GovernanceAmendmentProposed,
        PipelineEventType.GovernanceAuditReport,
        PipelineEventType.GovernanceComplianceViolation,
        PipelineEventType.GovernanceRoundtableConsensus,
    ];
    /**
     * 处理事件——转换为通知并发送到 NotificationPipe。
     *
     * llm-inference 来源的治理事件自动降级语义：
     *   DECISION_REQUIRED → WARNING
     *   WARNING → FYI
     */
    /** 治理事件走零 token 规则验证——llm-inference 来源降级语义 */
    _downgradeIfLlmInference(event, semantics) {
        if (!this.options.governanceValidator)
            return semantics;
        if (!NotificationRuntime.GOVERNANCE_EVENT_TYPES.includes(event.type))
            return semantics;
        const result = this.options.governanceValidator.validate(event, { workspaceRoot: process.cwd() });
        if (result.source === "llm-inference") {
            // 降级：DECISION_REQUIRED → WARNING, WARNING → FYI
            if (semantics === "DECISION_REQUIRED")
                return "WARNING";
            if (semantics === "WARNING")
                return "FYI";
        }
        return semantics;
    }
    _handleEvent(event) {
        const rawSemantics = this._resolveSemantics(event.type);
        const semantics = this._downgradeIfLlmInference(event, rawSemantics);
        const notification = this._eventToNotification(event, semantics);
        if (!notification)
            return;
        // 发送到通知管线
        try {
            this.notificationPipe.push(notification);
        }
        catch (e) {
            console.warn(`[NotificationRuntime] 发送通知失败: ${String(e).slice(0, 200)}`);
        }
        // 遥测
        if (this.options.enableTelemetry !== false) {
            void recordTelemetry("notification.runtime.sent", 0, [
                { key: "eventType", value: event.type },
                { key: "semantics", value: semantics },
                { key: "channel", value: notification.channel },
            ]);
        }
    }
    /**
     * 解析事件语义——确定事件的语义层级。
     */
    _resolveSemantics(eventType) {
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
    _eventToNotification(event, semantics) {
        const payload = event.payload;
        if (!payload)
            return null;
        // 根据语义确定通道和 ack 设置
        const channel = semantics === "DECISION_REQUIRED"
            ? NotificationChannel.Urgent
            : semantics === "WARNING"
                ? NotificationChannel.Important
                : NotificationChannel.Routine;
        const ackRequired = semantics === "DECISION_REQUIRED";
        const baseEvent = {
            type: event.type,
            channel,
            ackRequired,
            requestId: event.requestId ?? `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            summary: this._extractSummary(event.type, payload),
            detail: this._extractDetail(payload),
            sourceAgent: payload.sourceAgent,
            timestamp: event.timestamp ?? Date.now(),
        };
        // 附加语义标注
        return withSemantics(baseEvent, semantics);
    }
    /**
     * 提取摘要——从 payload 中提取人类可读的摘要。
     */
    _extractSummary(eventType, payload) {
        if (payload.summary)
            return String(payload.summary);
        if (payload.error)
            return `错误: ${String(payload.error).slice(0, 100)}`;
        if (payload.source)
            return `${eventType}: ${String(payload.source)}`;
        return eventType;
    }
    /**
     * 提取详情——从 payload 中提取详细信息。
     */
    _extractDetail(payload) {
        if (payload.detail)
            return String(payload.detail);
        if (payload.hint)
            return String(payload.hint);
        return undefined;
    }
}
//# sourceMappingURL=notification-runtime.js.map