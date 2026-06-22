import { defineConfig } from "vitest/config";
import { resolveAlias } from "../vitest.ci.base.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 本地开�?vitest 配置�?
 * include 匹配 tests/ 目录下的测试文件�?
 * passWithNoTests 允许无测试文件时通过（llm 包当前测试较少）�?
 */
export default defineConfig({
  resolve: { alias: resolveAlias(__dirname) },
  test: {
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
    env: {
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
      DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
      DEEPSEEK_CHAT_MODEL: process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-v4-flash",
    },
  },
});
