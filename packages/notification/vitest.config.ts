import { defineConfig } from "vitest/config";

/**
 * @cortex/notification vitest 配置
 * @fix P0 — 添加 vitest 配置，与 engine/llm 保持一致
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
  },
});
