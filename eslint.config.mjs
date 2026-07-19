import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "**/tmp/",
      "**/test-output/",
      "**/dist-test/",
      ".cortex/",
      "projects/",
      "**/coverage/",
      "packages/vitest.ci.base.ts",
      "**/vitest.config.ts",
      "**/vite.config.ts",
      "**/vitest.ci.config.ts",
      "**/vitest.ci-slow.config.ts",
      "**/samples/**",
      "**/tests/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.cjs",
      "**/*.mjs",
      "packages/engine/scripts/**",
      "packages/desktop/src/renderer/public/**",
      "packages/scheduler/src/**/*.d.ts",
      "packages/scheduler/src/**/*.js",
      "packages/memory/examples/**",
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // ── 类型安全（error 级——不允许漂移） ──
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/prefer-optional-chain": "warn",

      // ── 异常处理铁律（error 级——不允许空 catch / 裸 throw） ──
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-throw-literal": "error",
      "@typescript-eslint/only-throw-error": "error",

      // ── 变量声明规范（error 级——消灭 let/const 漂移） ──
      "prefer-const": "error",
      "no-var": "error",

      // ── 异步规范 ──
      "no-return-await": "off",
      "@typescript-eslint/return-await": ["error", "always"],
      "require-await": "off",
      "@typescript-eslint/require-await": "off",

      // ── 控制台（禁止裸 console——统一走 PipelineObserver 管道；仅 warn/error 例外用于运行时日志）
      //   豁免需标注 // @justification 注释说明原因（例如："@cortex/llm 包无 observer 可用"）
      "no-console": ["error", { allow: ["warn", "error"] }],

      // ── 代码质量 ──
      "no-debugger": "error",
      // no-duplicate-imports 与 consistent-type-imports (prefer:type-imports) 冲突——
      // 拆分混合导入时 inevitable 产生同源 import type + import value，由 TS 编译器去重
      "@typescript-eslint/no-non-null-assertion": "error",

      // ── 类型导入规范 ──
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],

      // ── 函数复杂度 ──
      "max-lines-per-function": ["warn", { max: 350, skipBlankLines: true, skipComments: true }],
    },
  },
  // ── 实验性/移植代码豁免 ──
  {
    files: [
            "packages/cli/src/tui/tui-repl.ts",
            "packages/memory/src/cyrene/**", "packages/memory/src/worldbook.ts",
            "packages/memory-store/src/memory-store.ts",
            "packages/plugin-runner/src/types.ts",
            "packages/governance/src/consistency/init-verifier.ts",
            "packages/engine/src/bootstrap/bootstrap-engine.ts",
            "packages/platform/src/tool-descriptor.ts",
            "packages/cli/src/commands/**", "packages/cli/src/tui/renderer/tool-log.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  // ── CLI / Desktop 源码豁免（终端 & GUI 交互工具允许裸 console.log，但必须标注 @justification） ──
  {
    files: ["packages/cli/src/**/*.ts", "packages/fsm-compiler/src/cli/**/*.ts", "packages/desktop/src/**/*.ts", "packages/desktop/src/**/*.tsx"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error", "log"] }],
    },
  },
);
