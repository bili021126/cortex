import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/", "**/node_modules/", "**/tmp/", "**/test-output/", ".cortex/"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      // 方案D-1: 裸 console.error/warn 强制走 PipelineObserver 管道
      // console.log/info 仍允许（测试/调试用）
      "no-console": ["warn", { allow: ["log", "info", "debug", "trace", "dir", "time", "timeEnd"] }],
      // 方案D-2: 禁止空 catch {} 块——必须显式处理异常
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
);
