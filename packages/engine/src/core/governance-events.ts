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

/**
 * 治理事件类型——DocGovernAgent 专属事件。
 */
export type GovernanceEventType =
  | "governance.amendment_proposed"
  | "governance.audit_report"
  | "governance.compliance_violation"
  | "governance.roundtable_consensus";

/**
 * 治理事件 Payload。
 */
export interface GovernanceEventPayload {
  /** 事件类型 */
  type: GovernanceEventType;
  /** 提案/报告 ID */
  id: string;
  /** 摘要 */
  summary: string;
  /** 详情（可选） */
  detail?: string;
  /** 相关节点 ID（可选） */
  nodeId?: string;
  /** 是否需要用户确认 */
  requiresDecision?: boolean;
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
  constructor(private readonly observer: IPipelineObserver) {}

  /**
   * 发射修宪提案事件。
   */
  emitAmendmentProposed(payload: Omit<GovernanceEventPayload, "type">): void {
    this._emit("governance.amendment_proposed", {
      ...payload,
      type: "governance.amendment_proposed",
    }, payload.requiresDecision ? PipelinePriority.HIGH : PipelinePriority.NORMAL);
  }

  /**
   * 发射审计报告事件。
   */
  emitAuditReport(payload: Omit<GovernanceEventPayload, "type">): void {
    this._emit("governance.audit_report", {
      ...payload,
      type: "governance.audit_report",
    }, PipelinePriority.NORMAL);
  }

  /**
   * 发射合规违规事件。
   */
  emitComplianceViolation(payload: Omit<GovernanceEventPayload, "type">): void {
    this._emit("governance.compliance_violation", {
      ...payload,
      type: "governance.compliance_violation",
    }, PipelinePriority.HIGH);
  }

  /**
   * 发射圆桌共识事件。
   */
  emitRoundtableConsensus(payload: Omit<GovernanceEventPayload, "type">): void {
    this._emit("governance.roundtable_consensus", {
      ...payload,
      type: "governance.roundtable_consensus",
    }, PipelinePriority.NORMAL);
  }

  /**
   * 通用发射——直接发射原始事件。
   */
  private _emit(type: GovernanceEventType, payload: GovernanceEventPayload, priority: PipelinePriority): void {
    const event: ObservableEvent = {
      type: type as unknown as PipelineEventType,
      priority,
      payload,
      timestamp: Date.now(),
      notificationType: payload.requiresDecision ? "DECISION_REQUIRED" : "FYI",
    };
    this.observer.emit(event);
  }
}
