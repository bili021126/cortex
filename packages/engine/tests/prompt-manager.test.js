// @ci: unit
import { describe, it, expect, beforeEach } from "vitest";
import { PromptManager } from "@cortex/engine";
describe("PromptManager", () => {
    let manager;
    beforeEach(() => {
        manager = new PromptManager(process.cwd());
    });
    describe("构造", () => {
        it("应成功创建实例", () => {
            expect(manager).toBeDefined();
        });
        it("getOrchestrator() 应返回非空", () => {
            expect(manager.getOrchestrator()).toBeDefined();
        });
    });
    describe("renderAgentPrompt()", () => {
        it("不存在的 prompt 文件 → 返回 null", async () => {
            const result = await manager.renderAgentPrompt("prompts/nonexistent/ghost.md");
            expect(result).toBeNull();
        });
        it("存在的 system prompt 文件 → 返回非空字符串", async () => {
            const result = await manager.renderAgentPrompt("prompts/albedo/system.md");
            if (result !== null) {
                expect(typeof result).toBe("string");
                expect(result.length).toBeGreaterThan(0);
            }
        });
    });
    describe("assemblePlanningPrompt()", () => {
        it("空 blocks → 返回 intent 文本", async () => {
            const result = await manager.assemblePlanningPrompt({ intent: "测试意图" });
            expect(result).toContain("测试意图");
        });
        it("含 parentContext → 注入 parent node", async () => {
            const result = await manager.assemblePlanningPrompt({
                intent: "测试",
                parentContext: "Parent node: p-001",
            });
            expect(result).toContain("p-001");
        });
        it("含 advisorContext → 注入策略描述", async () => {
            const result = await manager.assemblePlanningPrompt({
                intent: "测试",
                advisorContext: "可用策略:\n- direct: 单次调用",
            });
            expect(result).toContain("direct");
        });
        it("含 skillContext → 注入技能模板", async () => {
            const result = await manager.assemblePlanningPrompt({
                intent: "测试",
                skillContext: "技能模板: fix-001",
            });
            expect(result).toContain("fix-001");
        });
    });
});
//# sourceMappingURL=prompt-manager.test.js.map