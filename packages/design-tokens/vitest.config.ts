import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@cortex/design-tokens",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
