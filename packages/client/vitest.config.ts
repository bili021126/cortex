import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 并行负载下首次冷启动偶发超时——失败自动重试一次
    retry: 1,
    include: ["tests/**/*.test.ts"],
  },
});
