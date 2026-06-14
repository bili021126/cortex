// ============================================================
// @cortex/engine/platform/tools/delete-file —— delete_file 工具
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================

import { ToolCategory, ReversibilityLevel as RL, type Tool } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
import type { ToolContext } from "./types.js";

export function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "delete_file",
    ToolCategory.Write,
    "Delete a file at the given path. Irreversible — use with caution.",
    {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to file to delete" },
      },
      required: ["file_path"],
    },
    RL.L3,
    async (params) => {
      const filePath = ctx.resolvePath(params.file_path as string);
      try {
        const exists = await ctx.fs.exists(filePath);
        if (!exists) {
          return { success: false, error: `文件不存在: ${filePath}` };
        }
        await ctx.fs.unlink(filePath);
        return { success: true, output: `已删除 ${filePath}` };
      } catch (e) {
        return { success: false, error: `删除失败: ${String(e)}` };
      }
    },
    { needsLock: true },
  );
}
