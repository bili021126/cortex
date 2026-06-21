/**
 * @cortex/plugin-runner — PluginValidator 测试
 * @ci: unit
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PluginValidator } from "../src/validator.js";
describe("PluginValidator — validator.ts", () => {
    let validator;
    beforeEach(() => {
        validator = new PluginValidator();
    });
    it("registerSchema() 应成功注册", () => {
        validator.registerSchema({
            name: "test",
            validateConfig: () => [],
        });
        expect(validator.hasSchema("test")).toBe(true);
    });
    it("registerSchema() 重复注册应抛异常", () => {
        validator.registerSchema({ name: "test", validateConfig: () => [] });
        expect(() => validator.registerSchema({ name: "test", validateConfig: () => [] })).toThrow("重复注册");
    });
    it("unregisterSchema() 应成功注销", () => {
        validator.registerSchema({ name: "test", validateConfig: () => [] });
        expect(validator.unregisterSchema("test")).toBe(true);
        expect(validator.hasSchema("test")).toBe(false);
    });
    it("validateConfig() 配置合法应返回 valid=true", () => {
        validator.registerSchema({
            name: "test",
            validateConfig: (config) => {
                const c = config;
                const errors = [];
                if (!c.enabled)
                    errors.push("enabled 必须为 true");
                return errors;
            },
        });
        const result = validator.validateConfig("test", { enabled: true });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });
    it("validateConfig() 配置非法应返回错误列表", () => {
        validator.registerSchema({
            name: "test",
            validateConfig: (config) => {
                const c = config;
                const errors = [];
                if (!c.enabled)
                    errors.push("enabled 必须为 true");
                return errors;
            },
        });
        const result = validator.validateConfig("test", { enabled: false });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("enabled 必须为 true");
    });
    it("validateConfig() schema 不存在应视为通过", () => {
        const result = validator.validateConfig("nonexistent", {});
        expect(result.valid).toBe(true);
    });
    it("validateInput() 和 validateOutput() 未定义时应视为通过", () => {
        validator.registerSchema({
            name: "test",
            validateConfig: () => [],
        });
        expect(validator.validateInput("test", {}).valid).toBe(true);
        expect(validator.validateOutput("test", {}).valid).toBe(true);
    });
});
//# sourceMappingURL=validator.test.js.map