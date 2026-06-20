// @ci: unit
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PipelineEventType, PipelinePriority, type IPipelineObserver, type ObservableEvent } from "@cortex/shared";
import { GovernanceEventEmitter } from "@cortex/engine";

/** Mock PipelineObserver */
function mockObserver(): IPipelineObserver & { emittedEvents: ObservableEvent[] } {
  const emittedEvents: ObservableEvent[] = [];
  return {
    emittedEvents,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn((event: ObservableEvent) => {
      emittedEvents.push(event);
    }),
    onHandlerError: vi.fn(),
    createSafeReporter: vi.fn(),
  } as any;
}

describe("GovernanceEventEmitter", () => {
  let observer: ReturnType<typeof mockObserver>;
  let emitter: GovernanceEventEmitter;

  beforeEach(() => {
    observer = mockObserver();
    emitter = new GovernanceEventEmitter(observer);
  });

  describe("emitAmendmentProposed() 修宪提案", () => {
    it("应发射 governance.amendment_proposed 事件", () => {
      emitter.emitAmendmentProposed({
        id: "amend-001",
        summary: "修改宪法第 3 条",
        detail: "详细提案内容...",
      });

      expect(observer.emittedEvents).toHaveLength(1);
      const event = observer.emittedEvents[0];
      expect(event.payload).toMatchObject({
        type: "governance.amendment_proposed",
        id: "amend-001",
        summary: "修改宪法第 3 条",
      });
    });

    it("requiresDecision=true → 优先级为 HIGH", () => {
      emitter.emitAmendmentProposed({
        id: "amend-002",
        summary: "需要决策的提案",
        requiresDecision: true,
      });

      expect(observer.emittedEvents[0].priority).toBe(PipelinePriority.HIGH);
    });

    it("requiresDecision 未设 → 优先级为 NORMAL", () => {
      emitter.emitAmendmentProposed({
        id: "amend-003",
        summary: "普通提案",
      });

      expect(observer.emittedEvents[0].priority).toBe(PipelinePriority.NORMAL);
    });
  });

  describe("emitAuditReport() 审计报告", () => {
    it("应发射 governance.audit_report 事件", () => {
      emitter.emitAuditReport({
        id: "audit-001",
        summary: "季度合规审计",
        nodeId: "task-node-1",
      });

      expect(observer.emittedEvents).toHaveLength(1);
      const payload = observer.emittedEvents[0].payload as any;
      expect(payload.type).toBe("governance.audit_report");
      expect(payload.nodeId).toBe("task-node-1");
    });

    it("优先级始终为 NORMAL", () => {
      emitter.emitAuditReport({
        id: "audit-002",
        summary: "审计报告",
      });

      expect(observer.emittedEvents[0].priority).toBe(PipelinePriority.NORMAL);
    });
  });

  describe("emitComplianceViolation() 合规违规", () => {
    it("应发射 governance.compliance_violation 事件", () => {
      emitter.emitComplianceViolation({
        id: "violation-001",
        summary: "违反 P1-5 模块边界规则",
      });

      expect(observer.emittedEvents).toHaveLength(1);
      const payload = observer.emittedEvents[0].payload as any;
      expect(payload.type).toBe("governance.compliance_violation");
    });

    it("优先级始终为 HIGH", () => {
      emitter.emitComplianceViolation({
        id: "violation-002",
        summary: "合规违规",
      });

      expect(observer.emittedEvents[0].priority).toBe(PipelinePriority.HIGH);
    });
  });

  describe("emitRoundtableConsensus() 圆桌共识", () => {
    it("应发射 governance.roundtable_consensus 事件", () => {
      emitter.emitRoundtableConsensus({
        id: "consensus-001",
        summary: "三方达成共识：采用方案 B",
      });

      expect(observer.emittedEvents).toHaveLength(1);
      const payload = observer.emittedEvents[0].payload as any;
      expect(payload.type).toBe("governance.roundtable_consensus");
    });

    it("优先级始终为 NORMAL", () => {
      emitter.emitRoundtableConsensus({
        id: "consensus-002",
        summary: "圆桌共识",
      });

      expect(observer.emittedEvents[0].priority).toBe(PipelinePriority.NORMAL);
    });
  });

  describe("事件通用属性", () => {
    it("每个事件都有 timestamp", () => {
      emitter.emitAuditReport({ id: "test", summary: "test" });
      expect(observer.emittedEvents[0].timestamp).toBeGreaterThan(0);
    });

    it("notificationType 根据 requiresDecision 设置", () => {
      emitter.emitAmendmentProposed({
        id: "a",
        summary: "s",
        requiresDecision: true,
      });
      expect((observer.emittedEvents[0] as any).notificationType).toBe("DECISION_REQUIRED");

      emitter.emitAmendmentProposed({
        id: "b",
        summary: "s",
      });
      expect((observer.emittedEvents[1] as any).notificationType).toBe("FYI");
    });
  });
});
