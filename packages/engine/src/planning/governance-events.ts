// ============================================================
// @cortex/engine/planning/governance-events —— 治理事件发射器
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

import { PipelineEventType, PipelinePriority, type EmittableEvent, type GovernanceEventPayload as SharedGovernanceEventPayload, type IPipelineObserver } from "@cortex/shared";
import { GOVERNANCE_EVENT_ROUTING } from "@cortex/config";
import type { LoopStrategyRegistry } from "../core/loop-strategy-registry.js";
import { HardVerificationGate, emitGateRejection } from "./hard-verification-gate.js";

/**
 * 治理事件类型——映射到 PipelineEventType 枚举值。
 */
export type GovernanceEventType =
  | PipelineEventType.GovernanceAmendmentProposed
  | PipelineEventType.GovernanceAuditReport
  | PipelineEventType.GovernanceComplianceViolation
  | PipelineEventType.GovernanceRoundtableConsensus;

/** 治理事件 Payload（扩展 @cortex/shared 的基础类型） */
export interface GovernanceEventPayload extends SharedGovernanceEventPayload {
  type: GovernanceEventType;
  id: string;
  nodeId?: string;
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

  // M20 fix: 四方法仅事件类型不同——合并为单方法 + 便捷别名保持 API 兼容
  private emitByType(type: GovernanceEventType, payload: Omit<GovernanceEventPayload, "type">): void {
    this._emit(type, { ...payload, type });
  }

  emitAmendmentProposed = (payload: Omit<GovernanceEventPayload, "type">): void =>
    this.emitByType(PipelineEventType.GovernanceAmendmentProposed, payload);

  emitAuditReport = (payload: Omit<GovernanceEventPayload, "type">): void =>
    this.emitByType(PipelineEventType.GovernanceAuditReport, payload);

  emitComplianceViolation = (payload: Omit<GovernanceEventPayload, "type">): void =>
    this.emitByType(PipelineEventType.GovernanceComplianceViolation, payload);

  emitRoundtableConsensus = (payload: Omit<GovernanceEventPayload, "type">): void =>
    this.emitByType(PipelineEventType.GovernanceRoundtableConsensus, payload);

  /**
   * 通用发射——直接发射原始事件。
   * type 拓宽为 PipelineEventType（全枚举），使每个 EmittableEvent 成员均有交叠，
   * 单层 as 断言通过。移除 unknown 中转——TS 仍校验事件结构完备性。
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

    this.observer.emit({
      type: type as PipelineEventType,
      priority: routing?.notificationType === "DECISION_REQUIRED"
        ? PipelinePriority.HIGH
        : PipelinePriority.NORMAL,
      payload: enrichedPayload,
      timestamp: Date.now(),
      notificationType: routing?.notificationType ?? "FYI",
    } as EmittableEvent);
  }
}
