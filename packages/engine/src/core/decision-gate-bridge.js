// ============================================================
// @cortex/engine/core/decision-gate-bridge —— DECISION_REQUIRED → ConfirmGate 桥接
//
// @layer 治理层→交互层
// @role 桥接——观察者→确认门，权轴桥接
//
// 职责：
//   将通知系统的 DECISION_REQUIRED 语义映射到 ConfirmGate 的确认机制。
//   当 GovernanceEventEmitter 发射 requiresDecision=true 的事件时，
//   自动通过 ConfirmGate 请求用户确认。
//
// 设计原则：
//   1. 桥接而非耦合——通知系统和 ConfirmGate 各自独立，桥接层负责翻译
//   2. 超时安全——确认超时自动拒绝，避免流程卡死
//   3. 可观测性——每次桥接都有日志和遥测
// ============================================================
import { PipelinePriority } from "@cortex/shared";
import { recordTelemetry } from "@cortex/telemetry";
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
export class DecisionGateBridge {
    observer;
    confirmGate;
    _started = false;
    _handler;
    /** 确认超时 (ms) */
    timeoutMs;
    constructor(observer, confirmGate, options = {}) {
        this.observer = observer;
        this.confirmGate = confirmGate;
        this.timeoutMs = options.timeoutMs ?? 120_000;
    }
    /**
     * 启动桥接——订阅 PipelineObserver 的治理事件。
     */
    start() {
        if (this._started)
            return;
        this._started = true;
        this._handler = (event) => {
            this._handleEvent(event);
        };
        // 订阅 HIGH 优先级事件（治理事件通常是 HIGH）
        this.observer.on(PipelinePriority.HIGH, this._handler);
    }
    /**
     * 停止桥接。
     */
    stop() {
        this._started = false;
        if (this._handler)
            this.observer.off(PipelinePriority.HIGH, this._handler);
    }
    /**
     * 处理事件——检查是否需要决策。
     */
    _handleEvent(event) {
        const payload = event.payload;
        if (!payload)
            return;
        // 检查是否需要决策
        const requiresDecision = payload.requiresDecision === true;
        const notificationType = event.notificationType;
        if (!requiresDecision && notificationType !== "DECISION_REQUIRED") {
            return;
        }
        // 构建决策请求
        const request = {
            requestId: event.requestId ?? `decision-${Date.now()}`,
            eventType: event.type,
            summary: payload.summary ?? "需要决策",
            detail: payload.detail,
            nodeId: payload.nodeId,
        };
        // 异步请求确认
        void this._requestDecision(request).then((result) => {
            this._emitDecisionResult(result);
        });
    }
    /**
     * 请求确认——通过 ConfirmGate 阻塞等待用户响应。
     */
    async _requestDecision(request) {
        const start = Date.now();
        try {
            // ConfirmGate 需要 ReversibilityLevel，这里用 L2（需要确认）
            // 注意：这是一个简化实现，实际可能需要扩展 ConfirmGate API
            const approved = await this.confirmGate.waitFor(request.requestId, this.timeoutMs);
            return {
                requestId: request.requestId,
                approved,
                durationMs: Date.now() - start,
            };
        }
        catch (_e) {
            // 超时或错误——自动拒绝
            return {
                requestId: request.requestId,
                approved: false,
                durationMs: Date.now() - start,
                timedOut: true,
            };
        }
    }
    /**
     * 发射决策结果事件。
     */
    _emitDecisionResult(result) {
        void recordTelemetry("decision.gate.result", result.durationMs, [
            { key: "requestId", value: result.requestId },
            { key: "approved", value: String(result.approved) },
            { key: "timedOut", value: String(result.timedOut ?? false) },
        ]);
        process.stderr.write(`[DecisionGateBridge] 决策结果: ${result.requestId} → ${result.approved ? "批准" : "拒绝"}` +
            (result.timedOut ? " (超时)" : ""));
    }
}
//# sourceMappingURL=decision-gate-bridge.js.map