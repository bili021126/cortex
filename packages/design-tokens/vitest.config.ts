import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 并行负载下首次冷启动偶发超时——失败自动重试一次
    retry: 1,
    name: "@cortex/design-tokens",
    // 2026-09-26 修正：此前是 include: ["src/**/*.test.ts"] + passWithNoTests: true ——
    // 一、测试目录与全仓约定（tests/**）不一致；二、零测试也静默通过，于是本包
    // 落在门禁测试矩阵之外（门禁按「有测试文件的包」分组）。现在按约定指向 tests/，
    // 并去掉 passWithNoTests：本包再退回零测试会显式失败，而不是静默通过。
    include: ["tests/**/*.test.ts"],
  },
});
