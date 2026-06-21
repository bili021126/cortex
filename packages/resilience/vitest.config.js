import { defineConfig } from "vitest/config";
export default defineConfig({
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
//# sourceMappingURL=vitest.config.js.map