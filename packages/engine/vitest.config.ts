import { defineConfig } from "vitest/config";
import { resolveAlias } from "../vitest.ci.base.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: resolveAlias(__dirname) },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [
      "tests/e2e/solo-flight-mock.test.ts",
      "tests/e2e/multi-agent-collab-mock.test.ts",
      "tests/e2e/strategist-agent-mock.test.ts",
    ],
    env: {
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
      DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
      DEEPSEEK_CHAT_MODEL: process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-v4-flash",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/**/*.d.ts",
      ],
    },
  },
});
