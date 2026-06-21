// @ci: unit
import { describe, it, expect } from "vitest";
import { LoopStrategyRegistry, loopStrategyRegistry } from "@cortex/engine";
/** 构造测试用 TaskNode */
function makeNode(overrides = {}) {
    return {
        id: "test-node-1",
        type: "implementation",
        tags: ["implementation"],
        needsMultiPerspective: false,
        status: "pending",
        claimedBy: [],
        payload: "Implement feature X",
        results: [],
        createdAt: Date.now(),
        ...overrides,
    };
}
describe("LoopStrategyRegistry", () => {
    describe("单例 loopStrategyRegistry", () => {
        it("应注册四条策略（direct, decompose, jury, react）", () => {
            const names = loopStrategyRegistry.list();
            expect(names).toContain("direct");
            expect(names).toContain("decompose");
            expect(names).toContain("jury");
            expect(names).toContain("react");
            expect(names).toHaveLength(4);
        });
        it("get() 应返回已注册策略定义", () => {
            const direct = loopStrategyRegistry.get("direct");
            expect(direct).toBeDefined();
            expect(direct.name).toBe("direct");
            expect(direct.description).toBeTruthy();
            expect(direct.pipeline).toBeDefined();
        });
        it("get() 对未注册策略返回 undefined", () => {
            expect(loopStrategyRegistry.get("nonexistent")).toBeUndefined();
        });
    });
    describe("selectByRule 规则路由", () => {
        it("短 payload + 无工具依赖标签 → 匹配 direct", () => {
            const node = makeNode({ payload: "分类这段文本" }); // < 200 字
            const result = loopStrategyRegistry.selectByRule(node);
            expect(result).not.toBeNull();
            expect(result.name).toBe("direct");
        });
        it("含 browser 标签 → 不匹配 direct（工具依赖）", () => {
            const node = makeNode({
                payload: "短文本",
                tags: ["browser"],
            });
            const result = loopStrategyRegistry.selectByRule(node);
            // browser 标签阻止 direct，应匹配后续策略或返回 null
            if (result) {
                expect(result.name).not.toBe("direct");
            }
        });
        it("超过 500 字 payload → 匹配 decompose", () => {
            const node = makeNode({
                payload: "A".repeat(501),
                tags: ["implementation"], // 有工具依赖 → 不匹配 direct
            });
            const result = loopStrategyRegistry.selectByRule(node);
            expect(result).not.toBeNull();
            expect(result.name).toBe("decompose");
        });
        it("isRlmSubtask=true → 匹配 decompose", () => {
            const node = makeNode({
                payload: "短任务",
                tags: ["shell"], // 工具依赖标签 → 阻止 direct
                isRlmSubtask: true,
            });
            const result = loopStrategyRegistry.selectByRule(node);
            expect(result).not.toBeNull();
            expect(result.name).toBe("decompose");
        });
        it("audit 标签 → 匹配 decompose", () => {
            const node = makeNode({
                payload: "A".repeat(201), // 超 direct 长度限制
                tags: ["audit"],
            });
            const result = loopStrategyRegistry.selectByRule(node);
            expect(result).not.toBeNull();
            expect(result.name).toBe("decompose");
        });
        it("needsMultiPerspective=true → 匹配 jury", () => {
            const node = makeNode({
                payload: "A".repeat(201), // 超过 direct 长度 → 不匹配 direct
                tags: ["implementation"], // 非 audit/scan/migration → 不匹配 decompose
                needsMultiPerspective: true,
            });
            const result = loopStrategyRegistry.selectByRule(node);
            expect(result).not.toBeNull();
            expect(result.name).toBe("jury");
        });
        it("无匹配策略 → 返回 null（调用方回退 react）", () => {
            // react 的 canHandle 永远返回 false，所以不注册规则
            // 需要构造一个不匹配 direct/decompose/jury 的节点
            const node = makeNode({
                payload: "A".repeat(201), // 超过 direct 长度
                tags: ["implementation"], // 非 audit/scan/migration → 不匹配 decompose
                needsMultiPerspective: false, // 不匹配 jury
            });
            const result = loopStrategyRegistry.selectByRule(node);
            expect(result).toBeNull();
        });
    });
    describe("getAdvisorContext 策略顾问上下文", () => {
        it("应返回非空字符串", () => {
            const ctx = loopStrategyRegistry.getAdvisorContext();
            expect(ctx).toBeTruthy();
            expect(typeof ctx).toBe("string");
        });
        it("应包含所有四条策略的名称", () => {
            const ctx = loopStrategyRegistry.getAdvisorContext();
            expect(ctx).toContain("direct");
            expect(ctx).toContain("decompose");
            expect(ctx).toContain("jury");
            expect(ctx).toContain("react");
        });
    });
    describe("自定义注册表", () => {
        it("register() 应添加新策略", () => {
            const custom = new LoopStrategyRegistry();
            custom.register({
                name: "direct",
                description: "test direct",
                canHandle: () => true,
                pipeline: [],
            });
            expect(custom.list()).toEqual(["direct"]);
            expect(custom.get("direct").description).toBe("test direct");
        });
        it("selectByRule 按注册顺序匹配", () => {
            const custom = new LoopStrategyRegistry();
            custom.register({
                name: "direct",
                description: "always matches",
                canHandle: () => true,
                pipeline: [],
            });
            custom.register({
                name: "decompose",
                description: "also matches",
                canHandle: () => true,
                pipeline: [],
            });
            const node = makeNode();
            const result = custom.selectByRule(node);
            expect(result.name).toBe("direct"); // 先注册的优先
        });
    });
});
//# sourceMappingURL=loop-strategy-registry.test.js.map