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
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
  },
});
