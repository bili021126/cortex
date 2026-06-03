// ============================================================
// @cortex/engine/platform/tools/list-files —— list_files 工具 Handler
// ============================================================

import type { ToolMeta } from "../toolkit.js";
import type { ToolContext } from "./types.js";
import type { ToolHandler } from "@cortex/shared";
import { ToolCategory } from "@cortex/shared";
import { ReversibilityLevel as RL } from "@cortex/shared";

export const meta: ToolMeta = {
  category: ToolCategory.Read,
  description: "List files and directories at the given path.",
  level: RL.L0,
  parameters: {
    type: "object",
    properties: {
      dir_path: { type: "string", description: "Absolute path to directory (default: current workspace)" },
      pattern: { type: "string", description: "Glob filter pattern (optional, e.g. '*.ts')" },
    },
    required: [],
  },
  required: [],
};

export function createHandler(ctx: ToolContext): ToolHandler {
  return async (params) => {
    const dirPath = params.dir_path
      ? ctx.resolvePath(params.dir_path as string)
      : (ctx.workspaceRoot ?? ctx.fs.cwd());
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
  };
}
