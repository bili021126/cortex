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

import { PipelineEventType, PipelinePriority, type GovernanceEventPayload as SharedGovernanceEventPayload, type IPipelineObserver } from "@cortex/shared";
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
 * 按事件类型分发的治理事件 Payload——可辨识联合，TS 强制补全各事件特有字段。
 *
 *   - amendment_proposed → amendmentId
 *   - audit_report        → auditType
 *   - compliance_violation → violationLevel
 *   - roundtable_consensus → participants
 */
export type GovernanceEventPayloadByType = {
  [PipelineEventType.GovernanceAmendmentProposed]: GovernanceEventPayload & { amendmentId: string };
  [PipelineEventType.GovernanceAuditReport]: GovernanceEventPayload & { auditType: "plan_review" | "doc_audit" | "constitution_check" };
  [PipelineEventType.GovernanceComplianceViolation]: GovernanceEventPayload & { violationLevel: "P0" | "P1" | "P2" | "P3" };
  [PipelineEventType.GovernanceRoundtableConsensus]: GovernanceEventPayload & { participants: string[] };
};

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
  private emitByType<T extends GovernanceEventType>(type: T, payload: Omit<GovernanceEventPayloadByType[T], "type">): void {
    // as 收窄：payload 字段与 type: T 字面量拼接后即为 GovernanceEventPayloadByType[T]
    this._emitTyped(type, { ...payload, type } as GovernanceEventPayloadByType[T]);
  }

  emitAmendmentProposed = (payload: Omit<GovernanceEventPayloadByType[PipelineEventType.GovernanceAmendmentProposed], "type">): void =>
    this.emitByType(PipelineEventType.GovernanceAmendmentProposed, payload);

  emitAuditReport = (payload: Omit<GovernanceEventPayloadByType[PipelineEventType.GovernanceAuditReport], "type">): void =>
    this.emitByType(PipelineEventType.GovernanceAuditReport, payload);

  emitComplianceViolation = (payload: Omit<GovernanceEventPayloadByType[PipelineEventType.GovernanceComplianceViolation], "type">): void =>
    this.emitByType(PipelineEventType.GovernanceComplianceViolation, payload);

  emitRoundtableConsensus = (payload: Omit<GovernanceEventPayloadByType[PipelineEventType.GovernanceRoundtableConsensus], "type">): void =>
    this.emitByType(PipelineEventType.GovernanceRoundtableConsensus, payload);

  /**
   * 类型化发射——payload 由 GovernanceEventPayloadByType[T] 锁定，TS 强制补全特有字段。
   *
   * 不用 as EmittableEvent 逃逸：switch 将泛型 T 收窄为具体字面量，
   * observer.emit 的对象字面量即可直接匹配 EmittableEvent 联合成员。
   */
  private _emitTyped<T extends GovernanceEventType>(type: T, payload: GovernanceEventPayloadByType[T]): void {
    const routing = GOVERNANCE_EVENT_ROUTING[type];
    const priority = routing?.notificationType === "DECISION_REQUIRED"
      ? PipelinePriority.HIGH
      : PipelinePriority.NORMAL;
    const notificationType = routing?.notificationType ?? "FYI";
    const timestamp = Date.now();

    // 硬验证门预检
    const gateResult = this._gate.check(payload);
    if (!gateResult.passed) {
      emitGateRejection(this.observer, payload, gateResult);
      return;
    }

    const enrichedPayload = this._strategyRegistry
      ? { ...payload, strategyContext: this._strategyRegistry.getAdvisorContext() }
      : payload;

    // switch 收窄 type 为具体字面量；payload 因泛型索引访问无法联动收窄，
    // 用 as 收窄到对应事件类型（case 已保证 type 匹配，运行时必带特有字段）
    switch (type) {
      case PipelineEventType.GovernanceAmendmentProposed:
        this.observer.emit({ type, priority, payload: enrichedPayload as GovernanceEventPayloadByType[PipelineEventType.GovernanceAmendmentProposed], timestamp, notificationType });
        break;
      case PipelineEventType.GovernanceAuditReport:
        this.observer.emit({ type, priority, payload: enrichedPayload as GovernanceEventPayloadByType[PipelineEventType.GovernanceAuditReport], timestamp, notificationType });
        break;
      case PipelineEventType.GovernanceComplianceViolation:
        this.observer.emit({ type, priority, payload: enrichedPayload as GovernanceEventPayloadByType[PipelineEventType.GovernanceComplianceViolation], timestamp, notificationType });
        break;
      case PipelineEventType.GovernanceRoundtableConsensus:
        this.observer.emit({ type, priority, payload: enrichedPayload as GovernanceEventPayloadByType[PipelineEventType.GovernanceRoundtableConsensus], timestamp, notificationType });
        break;
    }
  }
}
