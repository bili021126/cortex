import { defineConfig } from "vitest/config";
/**
 * CI 快速单元测试——排除需要全引擎启动（ONNX + SQLite + bootstrap）的集成测试。
 * 慢速测试由 vitest.ci-slow.config.ts 单独跑。
 *
 * ⚠️ vitest 2.1.9 的 exclude（config 字段和 CLI --exclude）均不可靠，
 * 故改用 include 的 picomatch ! 否定 glob 来排除。
 */
export default defineConfig({
    test: {
        include: [
            "tests/**/*.test.ts",
            "!tests/bootstrap-integration*",
            "!tests/skill-bootstrap*",
            "!tests/skill-system-integration*",
            "!tests/system-stress*",
            "!tests/task-board-stress*",
            "!tests/e2e/**",
        ],
        env: {
            DEEPSEEK_API_KEY: "",
            DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
            DEEPSEEK_CHAT_MODEL: "deepseek-v4-flash",
        },
    },
});
//# sourceMappingURL=vitest.ci.config.js.map