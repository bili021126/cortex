import { defineConfig } from "vitest/config";
import { resolveAlias } from "../vitest.ci.base.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: resolveAlias(__dirname) },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
