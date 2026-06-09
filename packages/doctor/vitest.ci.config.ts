import { defineConfig } from "vitest/config";

/**
 * CI 专用 vitest 配置。
 * exclude 由 ci-gate.ts 通过 @ci 标签动态注入。
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
