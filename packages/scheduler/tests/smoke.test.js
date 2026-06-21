/**
 * @cortex/scheduler — 烟雾测试
 * 验证核心调度接口导出完整性。
 */
import { describe, it, expect } from "vitest";
import { TaskBoard, AgentPool, topologicalSort, PipelineObserver } from "@cortex/scheduler";
describe("@cortex/scheduler barrel", () => {
    it("should instantiate TaskBoard", () => {
        const board = new TaskBoard();
        expect(board).toBeDefined();
    });
    it("should instantiate AgentPool", () => {
        const pool = new AgentPool();
        expect(pool).toBeDefined();
    });
    it("should instantiate PipelineObserver", () => {
        const observer = new PipelineObserver();
        expect(observer).toBeDefined();
    });
    it("topologicalSort should accept empty array", () => {
        const result = topologicalSort([]);
        expect(result).toEqual([]);
    });
});
//# sourceMappingURL=smoke.test.js.map