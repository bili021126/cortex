import { defineConfig } from "vitest/config";
/**
 * @cortex/telemetry vitest configuration.
 * Tests are located in tests/ directory.
 */
export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
    },
});
//# sourceMappingURL=vitest.config.js.map