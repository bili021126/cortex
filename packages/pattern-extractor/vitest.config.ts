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
    // 并行负载下首次冷启动偶发超时——失败自动重试一次
    retry: 1,
    include: ["tests/pattern.spec.ts", "tests/extractor.spec.ts", "tests/markdown-extractor.spec.ts"],  // R13-N2：markdown-extractor.spec 此前被白名单排除（唯一真实逻辑 spec）——scanner.spec.ts 仍排除（流式处理 OOM）
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
