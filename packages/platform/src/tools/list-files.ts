// ============================================================
// @cortex/engine/platform/tools/list-files —— list_files 工具
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================

import { ToolCategory, ReversibilityLevel as RL, type Tool } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
import type { ToolContext } from "./types.js";

export function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "list_files",
    ToolCategory.Read,
    "List files and directories at the given path.",
    {
      type: "object",
      properties: {
        dir_path: { type: "string", description: "Absolute path to directory (default: current workspace)" },
        pattern: { type: "string", description: "Glob filter pattern (optional, e.g. '*.ts')" },
      },
      required: [],
    },
    RL.L0,
    async (params) => {
      let dirPath: string;
      if (params.dir_path) {
        const given = params.dir_path as string;
        // 先尝试沙箱解析
        try {
          dirPath = ctx.resolvePath(given);
        } catch {
          // H1 fix: 沙箱解析失败时不应直接使用未验证的路径
          if (ctx.workspaceRoot) {
            const relative = given.replace(/^[/]+/, "").replace(/^[A-Z]:[/\\]/, "");
            dirPath = ctx.resolvePath(relative);
          } else {
            // 无 workspaceRoot 时尝试 fs.resolve 做基础规范化，仍可能越界但不直接裸用输入
            dirPath = ctx.fs.resolve(given);
          }
        }
        // 如果路径不存在但 workspaceRoot 已知，尝试相对解析
        if (!(await ctx.fs.exists(dirPath)) && ctx.workspaceRoot) {
          const relative = given.replace(/^[/]+/, "").replace(/^[A-Z]:[/\\]/, "");
          const altPath = ctx.fs.resolve(relative);
          if (altPath !== dirPath && await ctx.fs.exists(altPath)) dirPath = altPath;
        }
      } else {
        dirPath = ctx.workspaceRoot ?? ctx.fs.cwd();
      }
      try {
        const exists = await ctx.fs.exists(dirPath);
        if (!exists) {
          return { success: false, error: `目录不存在: ${dirPath}` };
        }
        const entries = await ctx.fs.listDirectory(dirPath);
        const pattern = params.pattern as string | undefined;
        let listing = entries
          .map((e) => `${e.isDirectory ? "[D]" : "[F]"} ${e.name}`)
          .join("\n");
        if (pattern) {
          const regex = new RegExp(
            "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
          );
          listing = entries
            .filter((e) => regex.test(e.name))
            .map((e) => `${e.isDirectory ? "[D]" : "[F]"} ${e.name}`)
            .join("\n");
        }
        return { success: true, output: listing || "(空目录)" };
      } catch (e) {
        return { success: false, error: `列目录失败: ${String(e)}` };
      }
    },
  );
}
