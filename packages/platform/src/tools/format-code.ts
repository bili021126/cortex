// ============================================================
// @cortex/engine/platform/tools/format-code —— format_code 工具
//
// 对指定文件（或 glob）执行代码格式化。支持 prettier / eslint / biome。
// 比裸 run_shell "npx prettier --write" 更安全——仅允许白名单命令。
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================

import { ToolCategory, ReversibilityLevel as RL, type Tool } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
import type { ToolContext } from "./types.js";

const ALLOWED_FORMATTERS = ["prettier", "eslint", "biome"] as const;
type Formatter = (typeof ALLOWED_FORMATTERS)[number];

export function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "format_code",
    ToolCategory.Write,
    "Format code in a file or directory using prettier, eslint, or biome. Safer than running shell commands directly.",
    {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the file or directory to format",
        },
        formatter: {
          type: "string",
          description: "Formatter to use: 'prettier' (default), 'eslint' (--fix), 'biome' (format --write), or 'both' (prettier then eslint)",
        },
        check_only: {
          type: "boolean",
          description: "If true, only check formatting without modifying files (default: false)",
        },
      },
      required: ["file_path"],
    },
    RL.L2,
    async (params) => {
      const filePath = ctx.resolvePath(params.file_path as string);
      const formatter = (params.formatter as string) || "prettier";
      const checkOnly = params.check_only === true;

      const cwd = ctx.workspaceRoot ?? ctx.fs.cwd();

      // 白名单校验
      const selected: Formatter[] =
        formatter === "both"
          ? ["prettier", "eslint"]
          : ALLOWED_FORMATTERS.includes(formatter as Formatter)
            ? [formatter as Formatter]
            : [];

      if (selected.length === 0) {
        return {
          success: false,
          error: `不支持的格式化器: "${formatter}"。可选: ${ALLOWED_FORMATTERS.join(", ")}, both`,
        };
      }

      const results: string[] = [];

      for (const fmt of selected) {
        let args: string[];
        switch (fmt) {
          case "prettier":
            args = checkOnly
              ? ["prettier", "--check", filePath]
              : ["prettier", "--write", filePath];
            break;
          case "eslint":
            args = checkOnly
              ? ["eslint", filePath]
              : ["eslint", "--fix", filePath];
            break;
          case "biome":
            args = checkOnly
              ? ["biome", "format", filePath]
              : ["biome", "format", "--write", filePath];
            break;
          default:
            continue;
        }

        try {
          const output = await ctx.fs.execFile("npx", args, {
            cwd,
            timeout: ctx.toolTimeouts.runShell ?? 60_000,
          });
          results.push(`[${fmt}] ${checkOnly ? "check" : "format"} OK:\n${output.slice(0, 2_000)}`);
        } catch (e) {
          const err = e as { stderr?: unknown; message?: string };
          const detail = err.stderr
            ? String(err.stderr).slice(0, 2_000)
            : (err.message?.slice(0, 500) ?? String(e));
          results.push(`[${fmt}] FAILED:\n${detail}`);
        }
      }

      return { success: true, output: results.join("\n\n") };
    },
  );
}
