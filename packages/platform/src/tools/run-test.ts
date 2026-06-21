// ============================================================
// @cortex/engine/platform/tools/run-test —— run_test 工具
//
// 运行测试——自动检测框架（vitest/jest/mocha/playwright）或手动指定。
// 先扫描项目根下的框架配置文件，再调用对应的 test runner。
//
// 检测优先级：
//   playwright.config.* → npx playwright test
//   vitest.config.*     → npx vitest run
//   jest.config.*       → npx jest
//   .mocharc.*          → npx mocha
//   兜底                → npx vitest run
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================

import { ToolCategory, ReversibilityLevel as RL, type Tool } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
import type { ToolContext } from "./types.js";

const FRAMEWORK_DETECT: Array<{ pattern: string; runner: string; args: string[] }> = [
  { pattern: "playwright.config.", runner: "playwright", args: ["test"] },
  { pattern: "vitest.config.", runner: "vitest", args: ["run"] },
  { pattern: "jest.config.", runner: "jest", args: [] },
  { pattern: ".mocharc", runner: "mocha", args: [] },
];

const FALLBACK_RUNNER = "vitest";
const FALLBACK_ARGS = ["run"];

export function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "run_test",
    ToolCategory.Shell,
    "Run tests with automatic test framework detection (vitest, jest, playwright, mocha). Detects the framework from config files, or use the 'framework' parameter to specify manually.",
    {
      type: "object",
      properties: {
        test_path: {
          type: "string",
          description: "Optional: specific test file or glob pattern to run (e.g. 'src/__tests__/foo.test.ts'). If omitted, runs all tests.",
        },
        framework: {
          type: "string",
          description: "Override auto-detection: 'vitest', 'jest', 'mocha', 'playwright', or 'auto' (default: auto)",
        },
        args: {
          type: "string",
          description: "Additional CLI args to pass to the test runner (e.g. '--reporter=verbose --coverage')",
        },
      },
      required: [],
    },
    RL.L2,
    async (params) => {
      const testPath = params.test_path as string | undefined;
      const framework = (params.framework as string) || "auto";
      const extraArgs = (params.args as string) || "";

      const cwd = ctx.workspaceRoot ?? ctx.fs.cwd();

      // ── 确定框架 ──
      let runner: string;
      let baseArgs: string[];

      if (framework !== "auto") {
        // 手动指定
        const found = FRAMEWORK_DETECT.find((f) => f.runner === framework);
        if (!found) {
          return {
            success: false,
            error: `不支持的测试框架: "${framework}"。可选: ${FRAMEWORK_DETECT.map((f) => f.runner).join(", ")}, auto`,
          };
        }
        runner = found.runner;
        baseArgs = [...found.args];
      } else {
        // 自动检测
        let detected: typeof FRAMEWORK_DETECT[number] | undefined;
        try {
          const entries = await ctx.fs.listDirectory(cwd);
          for (const detect of FRAMEWORK_DETECT) {
            if (entries.some((e) => e.name.startsWith(detect.pattern))) {
              detected = detect;
              break;
            }
          }
        } catch {
          // listDirectory 失败 → 兜底
        }

        if (detected) {
          runner = detected.runner;
          baseArgs = [...detected.args];
        } else {
          runner = FALLBACK_RUNNER;
          baseArgs = [...FALLBACK_ARGS];
        }
      }

      // ── 构建命令 ──
      const args: string[] = [runner, ...baseArgs];

      if (testPath) {
        args.push(testPath);
      }

      if (extraArgs) {
        args.push(...extraArgs.split(/\s+/).filter(Boolean));
      }

      try {
        const output = await ctx.fs.execFile("npx", args, {
          cwd,
          timeout: ctx.toolTimeouts.runShell ?? 120_000,
        });
        return {
          success: true,
          output: `[${runner}] ${testPath || "all tests"}\n${output.slice(0, 15_000)}`,
        };
      } catch (e) {
        const err = e as { stderr?: unknown; message?: string };
        const detail = err.stderr
          ? String(err.stderr).slice(0, 5_000)
          : (err.message?.slice(0, 1_000) ?? String(e));
        return {
          success: false,
          error: `[${runner}] 测试失败:\n${detail}`,
        };
      }
    },
  );
}
