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
      ".cortex/",
      "projects/",
      "**/coverage/",
      "packages/vitest.ci.base.ts",
      "**/vitest.config.ts",
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
      "@typescript-eslint/no-misused-promises": ["warn", { checksVoidReturn: false }],
      "@typescript-eslint/await-thenable": "warn",
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
      "@typescript-eslint/require-await": "warn",

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
      "max-params": ["warn", 3],
      "max-lines-per-function": ["warn", { max: 30, skipBlankLines: true, skipComments: true }],
    },
  },
  // ── CLI 源码豁免（终端交互工具允许裸 console） ──
  {
    files: ["packages/cli/src/**/*.ts", "packages/fsm-compiler/src/cli/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
);
