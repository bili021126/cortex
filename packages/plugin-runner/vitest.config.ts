import { defineConfig } from "vitest/config";

/**
 * @cortex/plugin-runner vitest 配置
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
  },
});
