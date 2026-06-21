import { describe, it, expect } from "vitest";
import { AgentType, AgentStatus, PipelineEventType, PipelinePriority, } from "../src/index.js";
describe("@cortex/shared smoke", () => {
    it("AgentType 枚举值对齐", () => {
        expect(AgentType.Code).toBe("code");
        expect(AgentType.Fix).toBe("fix");
        expect(AgentType.Ops).toBe("ops");
        expect(AgentType.Review).toBe("review");
        expect(AgentType.Meta).toBe("meta");
        expect(Object.values(AgentType).length).toBe(14);
    });
    it("AgentStatus 枚举值对齐", () => {
        expect(AgentStatus.Created).toBe("created");
        expect(AgentStatus.Awake).toBe("awake");
        expect(AgentStatus.Active).toBe("active");
        expect(AgentStatus.Destroyed).toBe("destroyed");
    });
    it("PipelineEventType 枚举值对齐", () => {
        expect(PipelineEventType.ErrorReported).toBe("error.reported");
        expect(PipelineEventType.ConstitutionViolation).toBe("constitution.violation");
        expect(PipelineEventType.NodeFailed).toBe("node.failed");
    });
    it("PipelinePriority 枚举值对齐", () => {
        expect(PipelinePriority.CRITICAL).toBe(0);
        expect(PipelinePriority.HIGH).toBe(1);
        expect(PipelinePriority.NORMAL).toBe(2);
    });
    it("ObservableEvent 类型可用", () => {
        const evt = {
            type: PipelineEventType.NodeStart,
            priority: PipelinePriority.NORMAL,
            payload: { nodeId: "n1" },
            timestamp: Date.now(),
        };
        expect(evt.type).toBe("node.start");
        expect(evt.requestId).toBeUndefined();
    });
});
//# sourceMappingURL=smoke.test.js.map