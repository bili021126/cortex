import { defineConfig } from "vitest/config";

/**
 * CI 慢速测试——仅跑需要全引擎启动（ONNX + SQLite + bootstrap）的集成测试。
 * 快速单元测试由 vitest.ci.config.ts 接管。
 */
export default defineConfig({
  test: {
    include: [
      "tests/bootstrap-integration*",
      "tests/skill-bootstrap*",
      "tests/skill-system-integration*",
      "tests/system-stress*",
    ],
    env: {
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
      DEEPSEEK_CHAT_MODEL: "deepseek-v4-flash",
    },
  },
});
