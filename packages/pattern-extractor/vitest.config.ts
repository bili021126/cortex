import { defineConfig } from "vitest/config";
import { resolveAlias } from "../vitest.ci.base.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @cortex/pattern-extractor vitest 配置�? * 测试文件统一放在 tests/ 目录下�? */
export default defineConfig({
  resolve: { alias: resolveAlias(__dirname) },
  test: {
    include: ["tests/pattern.spec.ts", "tests/extractor.spec.ts"],  // scanner.spec.ts OOM——Core-3 流式处理
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      NODE_OPTIONS: "--max-old-space-size=8192",  // 8GB heap for large test data
    },
  },
});
