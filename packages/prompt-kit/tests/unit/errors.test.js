// @ci: unit
/**
 * @cortex/prompt-kit — 错误类型单元测试
 */
import { describe, it, expect } from "vitest";
import { PromptError } from "../../src/errors.js";
import { PromptErrorCode } from "../../src/types.js";
describe("PromptError", () => {
    it("应创建基本错误", () => {
        const error = new PromptError("测试错误", PromptErrorCode.TEMPLATE_NOT_FOUND, { id: "test" });
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe("测试错误");
        expect(error.code).toBe(PromptErrorCode.TEMPLATE_NOT_FOUND);
        expect(error.details).toEqual({ id: "test" });
        expect(error.name).toBe("PromptError");
    });
    it("应支持无 details 创建", () => {
        const error = new PromptError("简单错误", PromptErrorCode.CACHE_ERROR);
        expect(error.message).toBe("简单错误");
        expect(error.details).toBeUndefined();
    });
    it("应支持各种错误码", () => {
        const codes = Object.values(PromptErrorCode);
        for (const code of codes) {
            const error = new PromptError(`错误: ${code}`, code);
            expect(error.code).toBe(code);
        }
    });
    it("应保持 instanceof 链", () => {
        const error = new PromptError("测试", PromptErrorCode.RENDER_FAILED);
        expect(error instanceof Error).toBe(true);
        expect(error instanceof PromptError).toBe(true);
    });
});
//# sourceMappingURL=errors.test.js.map