import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/!(llm|integration|e2e|manual)*.test.ts",
              "tests/**/!(*.llm|*.integration|*.e2e|*.manual).test.ts"],
  },
});
