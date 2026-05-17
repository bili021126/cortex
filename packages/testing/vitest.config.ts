import { defineConfig } from "vitest/config";

/**
 * 本地开发 vitest 配置。
 * include 匹配 tests/ 目录下的测试文件。
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
      DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
      DEEPSEEK_CHAT_MODEL: process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-chat",
    },
  },
});
