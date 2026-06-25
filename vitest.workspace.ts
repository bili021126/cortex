import { defineWorkspace } from "vitest/config";

/**
 * vitest workspace 根配置。
 *
 * 所有包独立并行执行（vitest 2.1.x 无 dependsOn，升级到 3.x 后可加拓扑约束）。
 * 需要有序执行时使用: vitest --workspace --project=@cortex/shared && vitest --workspace
 *
 * 使用:
 *   vitest --workspace               并行跑所有项目
 */
export default defineWorkspace([
  // ── 基础 / 核心包 ───────────────────────────────────
  "./packages/config/vitest.config.ts",
  "./packages/shared/vitest.config.ts",
  "./packages/memory/vitest.config.ts",
  "./packages/memory-store/vitest.config.ts",
  "./packages/consistency/vitest.config.ts",
  "./packages/governance/vitest.config.ts",
  "./packages/platform/vitest.config.ts",
  "./packages/scheduler/vitest.config.ts",

  // ── 叶包（无内部依赖，全部并行） ─────────────────────
  "./packages/cache/vitest.config.ts",
  "./packages/doctor/vitest.config.ts",
  "./packages/logging/vitest.config.ts",
  "./packages/fsm-compiler/vitest.config.ts",
  "./packages/llm/vitest.config.ts",
  "./packages/notification/vitest.config.ts",
  "./packages/parser/vitest.config.ts",
  "./packages/pattern-extractor/vitest.config.ts",
  "./packages/plugin-runner/vitest.config.ts",
  "./packages/pm/vitest.config.ts",
  "./packages/prompt-kit/vitest.config.ts",
  "./packages/resilience/vitest.config.ts",
  "./packages/skill-kit/vitest.config.ts",
  "./packages/telemetry/vitest.config.ts",
  "./packages/testing/vitest.config.ts",
  "./packages/tools/vitest.config.ts",
  "./packages/tui/vitest.config.ts",

  // ── 引擎 & CLI（较重，独立项目以便单独 --project 筛选） ──
  "./packages/context-manager/vitest.config.ts",
  "./packages/engine/vitest.config.ts",
  "./packages/cli/vitest.config.ts",
]);
