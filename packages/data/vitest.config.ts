import { defineConfig } from "vitest/config";

/**
 * 本地开发 vitest 配置。
 * include 覆盖 tests/ 目录下的测试文件。
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
