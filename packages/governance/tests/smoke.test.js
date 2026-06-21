// @ci: unit
import { describe, it, expect } from "vitest";
import { evaluateAmendment, checkTimeout, updateStaleCount, getRegisteredStages, } from "@cortex/governance";
describe("@cortex/governance — 导出完整性", () => {
    it("evaluateAmendment 为可调用函数", () => {
        expect(typeof evaluateAmendment).toBe("function");
    });
    it("checkTimeout 为可调用函数", () => {
        expect(typeof checkTimeout).toBe("function");
    });
    it("updateStaleCount 为可调用函数", () => {
        expect(typeof updateStaleCount).toBe("function");
    });
    it("getRegisteredStages 返回数组", () => {
        const stages = getRegisteredStages();
        expect(Array.isArray(stages)).toBe(true);
    });
});
//# sourceMappingURL=smoke.test.js.map