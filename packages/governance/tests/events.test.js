import { describe, it, expect } from "vitest";
import { PipelineEventType } from "@cortex/shared";
describe("Governance events — PipelineEventType", () => {
    it("ConstitutionViolation 事件类型存在", () => {
        expect(PipelineEventType.ConstitutionViolation).toBe("constitution.violation");
    });
    it("SessionConvened 事件类型存在", () => {
        expect(PipelineEventType.ConstitutionSessionConvened).toBe("constitution.session_convened");
    });
    it("SessionResolved 事件类型存在", () => {
        expect(PipelineEventType.ConstitutionSessionResolved).toBe("constitution.session_resolved");
    });
});
//# sourceMappingURL=events.test.js.map