import { defineConfig } from "vitest/config";

/**
 * 本地开发 vitest 配置。
 * 测试文件统一放在 tests/ 目录下，不再从 src/ 下扫描。
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
      DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
      DEEPSEEK_CHAT_MODEL: process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-v4-flash",
    },
  },
});
