// ============================================================
// @cortex/engine/execution/decision-gate-bridge —— DECISION_REQUIRED → ConfirmGate 桥接
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

import type { IPipelineObserver, ObservableEvent } from "@cortex/shared";
import { PipelineEventType, PipelinePriority } from "@cortex/shared";
import { ReversibilityLevel } from "@cortex/config";
import type { ConfirmGate } from "@cortex/scheduler";
import { recordTelemetry } from "@cortex/telemetry";

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
export class DecisionGateBridge {
  private _started = false;
  private _handler: ((event: ObservableEvent) => void) | undefined;

  /** 确认超时 (ms) */
  private readonly timeoutMs: number;

  constructor(
    private readonly observer: IPipelineObserver,
    private readonly confirmGate: ConfirmGate,
    options: { timeoutMs?: number } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  /**
   * 启动桥接——订阅 PipelineObserver 的治理事件。
   */
  start(): void {
    if (this._started) return;
    this._started = true;

    this._handler = (event: ObservableEvent) => {
      this._handleEvent(event);
    };
    // 订阅 HIGH 优先级事件（治理事件通常是 HIGH）
    this.observer.on(PipelinePriority.HIGH, this._handler);
  }

  /**
   * 停止桥接。
   */
  stop(): void {
    this._started = false;
    if (this._handler) this.observer.off(PipelinePriority.HIGH, this._handler);
  }

  /**
   * 处理事件——检查是否需要决策。
   */
  private _handleEvent(event: ObservableEvent): void {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    // 检查是否需要决策
    const requiresDecision = payload.requiresDecision === true;
    const notificationType = event.notificationType;

    if (!requiresDecision && notificationType !== "DECISION_REQUIRED") {
      return;
    }

    // 构建决策请求
    const request: DecisionRequest = {
      requestId: event.requestId ?? `decision-${Date.now()}`,
      eventType: event.type as string,
      summary: (payload.summary as string) ?? "需要决策",
      detail: payload.detail as string | undefined,
      nodeId: payload.nodeId as string | undefined,
    };

    // 异步请求确认
    void this._requestDecision(request).then((result) => {
      this._emitDecisionResult(result);
    }).catch(err => this._emitDecisionError(err));
  }

  /**
   * 请求确认——通过 ConfirmGate 阻塞等待用户响应。
   */
  private async _requestDecision(request: DecisionRequest): Promise<DecisionResult> {
    const start = Date.now();

    try {
      // R12-D1：waitFor 前注册 request（ConfirmGate 首行 !pending.has(id) 立即拒绝——决策链此前全死）
      this.confirmGate.request({
        id: request.requestId,
        toolName: "governance-decision",
        level: ReversibilityLevel.L2,
        summary: request.summary,
        detail: request.detail,
      });
      const approved = await this.confirmGate.waitFor(request.requestId, this.timeoutMs);

      return {
        requestId: request.requestId,
        approved,
        durationMs: Date.now() - start,
      };
    } catch (_e) {
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
  private _emitDecisionResult(result: DecisionResult): void {
    void recordTelemetry("decision.gate.result", result.durationMs, [
      { key: "requestId", value: result.requestId },
      { key: "approved", value: String(result.approved) },
      { key: "timedOut", value: String(result.timedOut ?? false) },
    ]).catch(err => console.error(`[decision-gate] result telemetry failed: ${err instanceof Error ? err.message : String(err)}`));

    console.error(
      `[DecisionGateBridge] 决策结果: ${result.requestId} → ${result.approved ? "批准" : "拒绝"}` +
      (result.timedOut ? " (超时)" : ""),
    );
  }

  /**
   * 发射决策错误事件——Promise rejection 不再被无声吞噬。
   */
  private _emitDecisionError(err: unknown): void {
    this.observer.emit({
      type: PipelineEventType.ErrorReported,
      priority: PipelinePriority.NORMAL,
      payload: {
        source: "DecisionGateBridge",
        severity: "error",
        error: err instanceof Error ? err.message : String(err),
        hint: "decision-request-failed",
      },
      timestamp: Date.now(),
      notificationType: "WARNING",
    });
  }
}
