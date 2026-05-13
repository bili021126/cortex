import { defineConfig } from "vitest/config";

/**
 * CI 专用 vitest 配置。
 * 排除规则已迁移至 ci-gate.ts 的 @ci 标签动态扫描——
 * 测试文件以 `// @ci: unit | llm | integration | e2e | manual` 自声明类别，
 * ci-gate.ts 运行时通过 --exclude 参数动态注入。
 * 此文件仅保留 include 和 env 配置，不硬编码排除列表。
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // exclude 由 ci-gate.ts 动态注入，不在此硬编码
    env: {
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
      DEEPSEEK_CHAT_MODEL: "deepseek-chat",
    },
  },
});
