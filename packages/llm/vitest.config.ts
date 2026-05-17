import { defineConfig } from "vitest/config";

/**
 * 本地开发 vitest 配置。
 * include 匹配 tests/ 目录下的测试文件。
 * passWithNoTests 允许无测试文件时通过（llm 包当前测试较少）。
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
    env: {
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
      DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
      DEEPSEEK_CHAT_MODEL: process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-chat",
    },
  },
});
