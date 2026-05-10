import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
      DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
      DEEPSEEK_CHAT_MODEL: process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-chat",
    },
  },
});
