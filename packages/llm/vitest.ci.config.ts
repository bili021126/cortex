import { defineConfig } from "vitest/config";

/**
 * CI 专用 vitest 配置。
 * llm 包当前无单元测试，passWithNoTests 防止 vitest 因无匹配文件而报错退出。
 * exclude 由 ci-gate.ts 通过 @ci 标签动态注入，不在此硬编码。
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
    env: {
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
      DEEPSEEK_CHAT_MODEL: "deepseek-chat",
    },
  },
});
