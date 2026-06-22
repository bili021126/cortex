import { defineConfig } from "vitest/config";
import { resolveAlias } from "../vitest.ci.base.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: resolveAlias(__dirname) },
  test: {
    include: ["tests/**/*.test.ts"],
  },
  coverage: {
    provider: "v8",
    reportsDirectory: "./coverage",
    exclude: ["node_modules/**", "dist/**"],
    include: ["src/**"],
    reporter: ["text", "html"],
  },
});
