import { defineConfig } from "vitest/config";
import { withBase } from "../vitest.ci.base";
/**
 * CI 专用 vitest 配置。
 * exclude 由 ci-gate.ts 通过 @ci 标签动态注入。
 */
export default withBase(defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
    },
}));
//# sourceMappingURL=vitest.ci.config.js.map