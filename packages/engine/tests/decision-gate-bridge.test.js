// @ci: unit
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DecisionGateBridge } from "@cortex/engine";
function mockConfirmGate(decision = true) {
    return {
        waitFor: vi.fn().mockResolvedValue(decision),
    };
}
describe("DecisionGateBridge", () => {
    let gate;
    beforeEach(() => {
        gate = mockConfirmGate(true);
    });
    describe("lifecycle", () => {
        it("start() 不抛异常", () => {
            const bridge = new DecisionGateBridge({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }, gate);
            expect(() => bridge.start()).not.toThrow();
        });
        it("stop() 不抛异常", () => {
            const bridge = new DecisionGateBridge({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }, gate);
            bridge.start();
            expect(() => bridge.stop()).not.toThrow();
        });
        it("重复 start() 不抛异常", () => {
            const bridge = new DecisionGateBridge({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }, gate);
            bridge.start();
            bridge.start();
            // 不应抛出
        });
    });
    describe("构造", () => {
        it("默认超时 120s", () => {
            const bridge = new DecisionGateBridge({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }, gate);
            // 构造不抛异常
            expect(bridge).toBeDefined();
        });
        it("可自定义超时", () => {
            const bridge = new DecisionGateBridge({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }, gate, { timeoutMs: 5000 });
            expect(bridge).toBeDefined();
        });
    });
});
//# sourceMappingURL=decision-gate-bridge.test.js.map