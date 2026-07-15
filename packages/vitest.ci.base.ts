import { defineConfig, mergeConfig } from "vitest/config";
import type { UserConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * 全量跨包 alias——将所有 @cortex/* 解析到源码 src/index.ts 而非 dist/。
 * 删 dist 不影响测试。每个包的 vitest.config.ts 调用 resolveAlias(__dirname) 即可。
 */
const ALL_PKGS = [
  "cli", "config", "consistency", "context-manager", "doctor", "fsm-compiler",
  "governance", "llm", "logging", "memory", "memory-store", "notification",
  "parser", "pattern-extractor", "platform", "plugin-runner", "prompt-kit",
  "resilience", "scheduler", "shared", "skill-kit", "telemetry", "testing", "tools", "tui",
];

export function resolveAlias(packageDir: string): Record<string, string> {
  const base = Object.fromEntries(
    ALL_PKGS.map((p) => [`@cortex/${p}`, resolve(packageDir, `../${p}/src/index.ts`)]),
  );
  // 子路径导出——pkg.json 的 exports["./subpath"] 映射
  // @cortex/memory/cyrene → memory/src/cyrene/index.ts
  base["@cortex/memory/cyrene"] = resolve(packageDir, "../memory/src/cyrene/index.ts");
  return base;
}

/**
 * CI vitest 公共基座配置。
 *
 * 所有包 vitest.ci.config.ts 均应 extend 此配置，
 * 避免 CI 配置漂移导致的"本地过 CI 不过"和"CI 过本地不过"。
 *
 * @governance 甘雨 P1：消除 11 包重复 CI 配置
 */
const base = defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});

/**
 * 合并基座与包特有配置。
 * 用法：export default withBase(defineConfig({ ... }))
 */
export function withBase(userConfig: UserConfig) {
  return mergeConfig(base, userConfig) as ReturnType<typeof defineConfig>;
}

export default base;
