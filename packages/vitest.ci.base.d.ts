import { defineConfig } from "vitest/config";
import type { UserConfig } from "vitest/config";
/**
 * CI vitest 公共基座配置。
 *
 * 所有包 vitest.ci.config.ts 均应 extend 此配置，
 * 避免 CI 配置漂移导致的"本地过 CI 不过"和"CI 过本地不过"。
 *
 * @governance 甘雨 P1：消除 11 包重复 CI 配置
 */
declare const base: import("vite").UserConfig;
/**
 * 合并基座与包特有配置。
 * 用法：export default withBase(defineConfig({ ... }))
 */
export declare function withBase(userConfig: UserConfig): ReturnType<typeof defineConfig>;
export default base;
//# sourceMappingURL=vitest.ci.base.d.ts.map