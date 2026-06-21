import { PipelineEventType, type IPipelineObserver } from "@cortex/shared";
import type { LoopStrategyRegistry } from "./loop-strategy-registry.js";
/**
 * 治理事件类型——映射到 PipelineEventType 枚举值。
 */
export type GovernanceEventType = PipelineEventType.GovernanceAmendmentProposed | PipelineEventType.GovernanceAuditReport | PipelineEventType.GovernanceComplianceViolation | PipelineEventType.GovernanceRoundtableConsensus;
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
export declare class GovernanceEventEmitter {
    private readonly observer;
    private readonly _strategyRegistry?;
    private readonly _gate;
    constructor(observer: IPipelineObserver, _strategyRegistry?: LoopStrategyRegistry | undefined);
    /**
     * 发射修宪提案事件。
     */
    emitAmendmentProposed(payload: Omit<GovernanceEventPayload, "type">): void;
    /**
     * 发射审计报告事件。
     */
    emitAuditReport(payload: Omit<GovernanceEventPayload, "type">): void;
    /**
     * 发射合规违规事件。
     */
    emitComplianceViolation(payload: Omit<GovernanceEventPayload, "type">): void;
    /**
     * 发射圆桌共识事件。
     */
    emitRoundtableConsensus(payload: Omit<GovernanceEventPayload, "type">): void;
    /**
     * 通用发射——直接发射原始事件。
     */
    private _emit;
}
//# sourceMappingURL=governance-events.d.ts.map