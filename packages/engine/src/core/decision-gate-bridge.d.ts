import type { IPipelineObserver } from "@cortex/shared";
import type { ConfirmGate } from "@cortex/scheduler";
/**
 * 决策请求——从治理事件中提取的确认请求。
 */
export interface DecisionRequest {
    /** 请求 ID（幂等键） */
    requestId: string;
    /** 事件类型 */
    eventType: string;
    /** 摘要（展示给用户） */
    summary: string;
    /** 详情（可选） */
    detail?: string;
    /** 相关节点 ID（可选） */
    nodeId?: string;
}
/**
 * 决策结果——ConfirmGate 的确认结果。
 */
export interface DecisionResult {
    /** 请求 ID */
    requestId: string;
    /** 是否批准 */
    approved: boolean;
    /** 决策耗时 (ms) */
    durationMs: number;
    /** 超时标记 */
    timedOut?: boolean;
}
/**
 * 决策门桥接器——连接通知系统的 DECISION_REQUIRED 和 ConfirmGate。
 *
 * 典型用法：
 *   ```typescript
 *   const bridge = new DecisionGateBridge(observer, confirmGate);
 *   bridge.start();
 *
 *   // 当 GovernanceEventEmitter 发射 requiresDecision=true 的事件时，
 *   // bridge 自动拦截并通过 ConfirmGate 请求确认。
 *   ```
 */
export declare class DecisionGateBridge {
    private readonly observer;
    private readonly confirmGate;
    private _started;
    private _handler;
    /** 确认超时 (ms) */
    private readonly timeoutMs;
    constructor(observer: IPipelineObserver, confirmGate: ConfirmGate, options?: {
        timeoutMs?: number;
    });
    /**
     * 启动桥接——订阅 PipelineObserver 的治理事件。
     */
    start(): void;
    /**
     * 停止桥接。
     */
    stop(): void;
    /**
     * 处理事件——检查是否需要决策。
     */
    private _handleEvent;
    /**
     * 请求确认——通过 ConfirmGate 阻塞等待用户响应。
     */
    private _requestDecision;
    /**
     * 发射决策结果事件。
     */
    private _emitDecisionResult;
}
//# sourceMappingURL=decision-gate-bridge.d.ts.map