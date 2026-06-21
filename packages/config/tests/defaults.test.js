// @ci: unit
import { describe, it, expect } from "vitest";
import { DEFAULT_ENGINE_CONFIG, resolveConfig } from "@cortex/config";
describe("@cortex/config — DEFAULT_ENGINE_CONFIG", () => {
    it("最大重规划配额与决策一致", () => {
        expect(DEFAULT_ENGINE_CONFIG.maxReplanPerNode).toBe(10);
        expect(DEFAULT_ENGINE_CONFIG.maxTotalReplans).toBe(50);
    });
    it("executeAllTimeoutMs 为 10 分钟", () => {
        expect(DEFAULT_ENGINE_CONFIG.executeAllTimeoutMs).toBe(600_000);
    });
    it("reactLoopTimeoutMs 为 5 分钟", () => {
        expect(DEFAULT_ENGINE_CONFIG.reactLoopTimeoutMs).toBe(300_000);
    });
    it("默认 LLM 指向 DeepSeek", () => {
        expect(DEFAULT_ENGINE_CONFIG.llm.baseUrl).toBe("https://api.deepseek.com/v1");
        expect(DEFAULT_ENGINE_CONFIG.llm.chatModel).toBe("deepseek-v4-flash");
    });
    it("嵌套对象默认均为完整值", () => {
        expect(DEFAULT_ENGINE_CONFIG.toolTimeouts.searchCode).toBeGreaterThan(0);
        expect(DEFAULT_ENGINE_CONFIG.toolTimeouts.runShell).toBeGreaterThan(0);
        expect(DEFAULT_ENGINE_CONFIG.inspector.tscTimeout).toBeGreaterThan(0);
    });
});
describe("@cortex/config — resolveConfig", () => {
    it("无参调用返回默认值副本", () => {
        const cfg = resolveConfig();
        expect(cfg.defaultMaxLoops).toBe(64);
        expect(cfg.maxReplanPerNode).toBe(10);
        // 副本不可影响全局默认
        cfg.defaultMaxLoops = 999;
        expect(DEFAULT_ENGINE_CONFIG.defaultMaxLoops).toBe(64);
    });
    it("部分覆盖——标量字段", () => {
        const cfg = resolveConfig({ defaultMaxLoops: 32 });
        expect(cfg.defaultMaxLoops).toBe(32);
        expect(cfg.maxReplanPerNode).toBe(10); // 未覆盖回退默认
    });
    it("部分覆盖——嵌套对象浅合并", () => {
        const cfg = resolveConfig({
            llm: { chatModel: "custom-model" },
        });
        expect(cfg.llm.chatModel).toBe("custom-model");
        expect(cfg.llm.baseUrl).toBe("https://api.deepseek.com/v1"); // 未覆盖回退
        expect(cfg.llm.reasonerModel).toBe("deepseek-v4-flash");
    });
    it("toolTimeouts 部分覆盖不丢其他字段", () => {
        const cfg = resolveConfig({
            toolTimeouts: { searchCode: 5000 },
        });
        expect(cfg.toolTimeouts.searchCode).toBe(5000);
        expect(cfg.toolTimeouts.runShell).toBe(60_000);
        expect(cfg.toolTimeouts.confirmWait).toBe(300_000);
    });
    it("backends 副本独立，不共享引用", () => {
        const cfg1 = resolveConfig();
        const cfg2 = resolveConfig({
            search: { backends: ["custom-backend"] },
        });
        expect(cfg2.search.backends).toEqual(["custom-backend"]);
        expect(cfg1.search.backends).toEqual([]);
    });
});
//# sourceMappingURL=defaults.test.js.map