// ============================================================
// @cortex/engine/core/governance-events —— 治理事件发射器
//
// @layer 治理层
// @role 观察者——事件发射，不消费
//
// 职责：
//   为 DocGovernAgent 提供治理事件发射能力。
//   治理事件走 PipelineObserver 管道，供 Sentinel/NotificationPipe 订阅。
//
// 治理事件类型：
//   - 修宪提案 (amendment_proposed)
//   - 审计报告 (audit_report)
//   - 合规违规 (compliance_violation)
//   - 圆桌共识 (roundtable_consensus)
// ============================================================

import { PipelineEventType, PipelinePriority, type IPipelineObserver, type ObservableEvent } from "@cortex/shared";
import { GOVERNANCE_EVENT_ROUTING } from "@cortex/config";
import type { LoopStrategyRegistry } from "./loop-strategy-registry.js";
import { HardVerificationGate, emitGateRejection } from "./hard-verification-gate.js";

/**
 * 治理事件类型——映射到 PipelineEventType 枚举值。
 */
export type GovernanceEventType =
  | PipelineEventType.GovernanceAmendmentProposed
  | PipelineEventType.GovernanceAuditReport
  | PipelineEventType.GovernanceComplianceViolation
  | PipelineEventType.GovernanceRoundtableConsensus;

/** 治理事件 Payload（对齐 shared 中的 GovernanceEventPayload） */
export interface GovernanceEventPayload {
  type: GovernanceEventType;
  id: string;
  summary: string;
  detail?: string;
  nodeId?: string;
  severity: "FYI" | "WARNING" | "DECISION_REQUIRED";
  source: "doc-govern" | "sentinel" | "confirm-gate" | "committee" | "strategist" | "governance-loop";
  suggestedAction?: "fix" | "ignore" | "escalate";
}

/**
 * 治理事件发射器——为 DocGovernAgent 提供事件发射能力。
 *
 * 典型用法：
 *   ```typescript
 *   const emitter = new GovernanceEventEmitter(observer);
 *   emitter.emitAmendmentProposed({
 *     id: "amend-001",
 *     summary: "提议修改宪法第 3 条",
 *     detail: "...",
 *     requiresDecision: true,
 *   });
 *   ```
 */
export class GovernanceEventEmitter {
  private readonly _gate = new HardVerificationGate();

  constructor(
    private readonly observer: IPipelineObserver,
    private readonly _strategyRegistry?: LoopStrategyRegistry,
  ) {}

  /**
   * 发射修宪提案事件。
   */
  emitAmendmentProposed(payload: Omit<GovernanceEventPayload, "type">): void {
    this._emit(PipelineEventType.GovernanceAmendmentProposed, {
      ...payload,
      type: PipelineEventType.GovernanceAmendmentProposed,
    });
  }

  /**
   * 发射审计报告事件。
   */
  emitAuditReport(payload: Omit<GovernanceEventPayload, "type">): void {
    this._emit(PipelineEventType.GovernanceAuditReport, {
      ...payload,
      type: PipelineEventType.GovernanceAuditReport,
    });
  }

  /**
   * 发射合规违规事件。
   */
  emitComplianceViolation(payload: Omit<GovernanceEventPayload, "type">): void {
    this._emit(PipelineEventType.GovernanceComplianceViolation, {
      ...payload,
      type: PipelineEventType.GovernanceComplianceViolation,
    });
  }

  /**
   * 发射圆桌共识事件。
   */
  emitRoundtableConsensus(payload: Omit<GovernanceEventPayload, "type">): void {
    this._emit(PipelineEventType.GovernanceRoundtableConsensus, {
      ...payload,
      type: PipelineEventType.GovernanceRoundtableConsensus,
    });
  }

  /**
   * 通用发射——直接发射原始事件。
   */
  private _emit(type: GovernanceEventType, payload: GovernanceEventPayload): void {
    const routing = GOVERNANCE_EVENT_ROUTING[type];

    // 硬验证门预检
    const gateResult = this._gate.check(payload);
    if (!gateResult.passed) {
      emitGateRejection(this.observer, payload, gateResult);
      return;
    }

    const enrichedPayload = this._strategyRegistry
      ? { ...payload, strategyContext: this._strategyRegistry.getAdvisorContext() }
      : payload;
    const event: ObservableEvent = {
      type,
      priority: routing?.notificationType === "DECISION_REQUIRED"
        ? PipelinePriority.HIGH
        : PipelinePriority.NORMAL,
      payload: enrichedPayload,
      timestamp: Date.now(),
      notificationType: routing?.notificationType ?? "FYI",
    };
    this.observer.emit(event);
  }
}
