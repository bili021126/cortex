import { defineConfig } from "vitest/config";
export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        exclude: ["tests/integration/**"],
    },
});
//# sourceMappingURL=vitest.ci.config.js.map