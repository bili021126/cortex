import { defineConfig } from "vitest/config";
/**
 * @cortex/skill-kit vitest 配置。
 * 测试文件统一放在 tests/ 目录下。
 */
export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
    },
});
//# sourceMappingURL=vitest.config.js.map