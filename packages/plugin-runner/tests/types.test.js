/**
 * @cortex/plugin-runner — 类型定义测试
 * @ci: unit
 */
import { describe, it, expect } from "vitest";
describe("类型定义 — types.ts", () => {
    it("Plugin 接口应有预期的结构（execute 返回 Promise<void>）", () => {
        // 编译期验证：确保 Plugin 接口的结构正确
        // execute 返回 Promise<void>，结果通过 ExecuteContext.output 传递
        const plugin = {
            name: "test-plugin",
            version: "1.0.0",
            description: "A test plugin",
            dependencies: [],
            tags: ["test"],
            hooks: {},
            init: async () => { },
            execute: async (_ctx) => {
                // 模拟：将结果写入 ctx.output
                _ctx.output = { done: true };
            },
            destroy: async () => { },
        };
        expect(plugin.name).toBe("test-plugin");
        expect(plugin.version).toBe("1.0.0");
    });
    it("PluginResult 应区分成功和失败", () => {
        const success = { success: true, durationMs: 10 };
        const failure = { success: false, error: "fail", durationMs: 5 };
        expect(success.success).toBe(true);
        expect(failure.success).toBe(false);
        expect(failure.error).toBe("fail");
    });
    it("PluginConfig 应包含 enabled 和可选字段", () => {
        const config = { enabled: true, timeout: 5000 };
        expect(config.enabled).toBe(true);
        expect(config.timeout).toBe(5000);
    });
    it("PluginStatus 的 phase 应为联合类型", () => {
        const status = {
            name: "p",
            phase: "created",
            executionCount: 0,
            failureCount: 0,
            healthy: true,
        };
        expect(status.phase).toBe("created");
    });
});
//# sourceMappingURL=types.test.js.map