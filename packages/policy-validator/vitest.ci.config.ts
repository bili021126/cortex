import { defineConfig } from "vitest/config";
import * as path from "node:path";

/**
 * CI 专用 vitest 配置。
 * exclude 由 ci-gate.ts 通过 @ci 标签动态注入。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@cortex/policy-validator": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
