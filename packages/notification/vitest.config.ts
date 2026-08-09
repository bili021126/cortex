import { defineConfig } from "vitest/config";
import { resolveAlias } from "../vitest.ci.base.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @cortex/notification vitest 配置
 * @fix P0 �?添加 vitest 配置，与 engine/llm 保持一�?
 */
export default defineConfig({
  resolve: { alias: resolveAlias(__dirname) },
  test: {
    // 并行负载下首次冷启动偶发超时——失败自动重试一次
    retry: 1,
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
  },
});
