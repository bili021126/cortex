import { PipelineEventType, type IPipelineObserver } from "@cortex/shared";
import type { NotificationPipe } from "@cortex/notification";
import { type NotificationSemantics } from "@cortex/notification";
import type { ZeroTokenValidator } from "./zero-token-validator.js";
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
export declare class NotificationRuntime {
    private readonly observer;
    private readonly notificationPipe;
    private readonly options;
    private _started;
    private _handler?;
    /** 默认语义映射 */
    private readonly defaultSemantics;
    constructor(observer: IPipelineObserver, notificationPipe: NotificationPipe, options?: NotificationRuntimeOptions);
    /**
     * 启动运行时——订阅 PipelineObserver 事件并转发到 NotificationPipe。
     */
    start(): void;
    /**
     * 停止运行时。
     */
    stop(): void;
    /** 治理事件类型列表 */
    private static readonly GOVERNANCE_EVENT_TYPES;
    /**
     * 处理事件——转换为通知并发送到 NotificationPipe。
     *
     * llm-inference 来源的治理事件自动降级语义：
     *   DECISION_REQUIRED → WARNING
     *   WARNING → FYI
     */
    /** 治理事件走零 token 规则验证——llm-inference 来源降级语义 */
    private _downgradeIfLlmInference;
    private _handleEvent;
    /**
     * 解析事件语义——确定事件的语义层级。
     */
    private _resolveSemantics;
    /**
     * 事件转通知——将 ObservableEvent 转换为 NotificationEvent。
     */
    private _eventToNotification;
    /**
     * 提取摘要——从 payload 中提取人类可读的摘要。
     */
    private _extractSummary;
    /**
     * 提取详情——从 payload 中提取详细信息。
     */
    private _extractDetail;
}
//# sourceMappingURL=notification-runtime.d.ts.map