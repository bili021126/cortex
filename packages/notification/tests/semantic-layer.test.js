// @ci: unit
import { describe, it, expect } from "vitest";
import { NotificationChannel, withSemantics, suggestRouting, SEMANTIC_TO_CHANNEL, SEMANTIC_DESCRIPTIONS, } from "../src/index.js";
/** 构造测试用 NotificationEvent */
function makeEvent(overrides = {}) {
    return {
        type: "test.event",
        channel: NotificationChannel.Routine,
        ackRequired: false,
        requestId: `req-${Date.now()}`,
        summary: "Test notification",
        timestamp: Date.now(),
        ...overrides,
    };
}
describe("Notification Semantic Layer", () => {
    describe("withSemantics() 语义增强", () => {
        it("FYI → 附加语义标注和描述", () => {
            const event = makeEvent();
            const enhanced = withSemantics(event, "FYI");
            expect(enhanced.semantics).toBe("FYI");
            expect(enhanced.semanticsDescription).toBe(SEMANTIC_DESCRIPTIONS.FYI);
            // 原始字段保留
            expect(enhanced.type).toBe("test.event");
            expect(enhanced.summary).toBe("Test notification");
        });
        it("WARNING → 附加语义标注", () => {
            const event = makeEvent();
            const enhanced = withSemantics(event, "WARNING");
            expect(enhanced.semantics).toBe("WARNING");
            expect(enhanced.semanticsDescription).toBeTruthy();
        });
        it("DECISION_REQUIRED → 附加语义标注", () => {
            const event = makeEvent();
            const enhanced = withSemantics(event, "DECISION_REQUIRED");
            expect(enhanced.semantics).toBe("DECISION_REQUIRED");
            expect(enhanced.semanticsDescription).toContain("决策");
        });
        it("不修改原始事件对象", () => {
            const event = makeEvent();
            const originalChannel = event.channel;
            withSemantics(event, "WARNING");
            expect(event.channel).toBe(originalChannel);
            expect(event.semantics).toBeUndefined(); // 原始事件未被修改
        });
    });
    describe("suggestRouting() 路由建议", () => {
        it("FYI → Routine 通道 + 无需 ack", () => {
            const routing = suggestRouting("FYI");
            expect(routing.channel).toBe(NotificationChannel.Routine);
            expect(routing.ackRequired).toBe(false);
        });
        it("WARNING → Important 通道 + 无需 ack", () => {
            const routing = suggestRouting("WARNING");
            expect(routing.channel).toBe(NotificationChannel.Important);
            expect(routing.ackRequired).toBe(false);
        });
        it("DECISION_REQUIRED → Urgent 通道 + 需要 ack", () => {
            const routing = suggestRouting("DECISION_REQUIRED");
            expect(routing.channel).toBe(NotificationChannel.Urgent);
            expect(routing.ackRequired).toBe(true);
        });
    });
    describe("SEMANTIC_TO_CHANNEL 映射表", () => {
        it("FYI 映射到 Routine", () => {
            expect(SEMANTIC_TO_CHANNEL.FYI).toBe(NotificationChannel.Routine);
        });
        it("WARNING 映射到 Important", () => {
            expect(SEMANTIC_TO_CHANNEL.WARNING).toBe(NotificationChannel.Important);
        });
        it("DECISION_REQUIRED 映射到 Urgent", () => {
            expect(SEMANTIC_TO_CHANNEL.DECISION_REQUIRED).toBe(NotificationChannel.Urgent);
        });
    });
    describe("SEMANTIC_DESCRIPTIONS 描述表", () => {
        it("所有语义层级都有非空描述", () => {
            const levels = ["FYI", "WARNING", "DECISION_REQUIRED"];
            for (const level of levels) {
                expect(SEMANTIC_DESCRIPTIONS[level]).toBeTruthy();
                expect(typeof SEMANTIC_DESCRIPTIONS[level]).toBe("string");
            }
        });
    });
});
//# sourceMappingURL=semantic-layer.test.js.map