import { defineConfig } from "vitest/config";
/**
 * @cortex/pattern-extractor vitest 配置。
 * 测试文件统一放在 tests/ 目录下。
 */
export default defineConfig({
    test: {
        include: ["tests/**/*.spec.ts"],
    },
});
//# sourceMappingURL=vitest.config.js.map