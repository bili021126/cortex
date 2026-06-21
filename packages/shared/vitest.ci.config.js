import { defineConfig } from "vitest/config";
/**
 * CI 专用 vitest 配置。
 * exclude 由 ci-gate.ts 通过 @ci 标签动态注入，不在此硬编码。
 * 测试文件统一放在 tests/ 目录下。
 */
export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        env: {
            DEEPSEEK_API_KEY: "",
            DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
            DEEPSEEK_CHAT_MODEL: "deepseek-v4-flash",
        },
    },
});
//# sourceMappingURL=vitest.ci.config.js.map