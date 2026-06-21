import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export default defineConfig({
    test: {
        include: ["src/__tests__/**/*.test.ts", "tests/**/*.test.ts"],
        environment: "node",
    },
    resolve: {
        alias: {
            "@cortex/scheduler": resolve(__dirname, "src"),
            "@cortex/shared": resolve(__dirname, "../shared/src"),
        },
    },
});
//# sourceMappingURL=vitest.config.js.map