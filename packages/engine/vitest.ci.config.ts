import { defineConfig } from "vitest/config";

/**
 * CI 专用 vitest 配置。
 * 排除需要真实 LLM 调用的 E2E/集成测试。
 * 北斗要求：所有纯单元测试必须在 CI 中跑通，零容忍。
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [
      // —— E2E 真实 LLM 依赖（需 DEEPSEEK_API_KEY）——
      "tests/manual/**",

      // —— Agent 集成测试（实例化需 LlmAdapter）——
      "tests/meta-agent.test.ts",
      "tests/multi-agent-collab.test.ts",
      "tests/task-board-stress.test.ts",
      "tests/code-agent.test.ts",
      "tests/review-agent.test.ts",
      "tests/inspector-agent.test.ts",
      "tests/doc-govern-agent.test.ts",
      "tests/butler-agent.test.ts",
      "tests/scheduler-dispatch.test.ts",
      "tests/cli-adapter.test.ts",
      "tests/pipeline-observer-reporting.test.ts",
      "tests/scheduler.test.ts",
      "tests/confirm-gate-cli.test.ts",
      "tests/task-board.test.ts",
    ],
    env: {
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
      DEEPSEEK_CHAT_MODEL: "deepseek-chat",
    },
  },
});
