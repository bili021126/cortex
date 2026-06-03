// ============================================================
// @cortex/engine/platform/tools/delete-file —— delete_file 工具 Handler
// ============================================================

import type { ToolMeta } from "../toolkit.js";
import type { ToolContext } from "./types.js";
import type { ToolHandler } from "@cortex/shared";
import { ToolCategory } from "@cortex/shared";
import { ReversibilityLevel as RL } from "@cortex/shared";

export const meta: ToolMeta = {
  category: ToolCategory.Write,
  description: "Delete a file at the given path. Irreversible — use with caution.",
  level: RL.L3,
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path to file to delete" },
    },
    required: ["file_path"],
  },
  required: ["file_path"],
};

export function createHandler(ctx: ToolContext): ToolHandler {
  return async (params) => {
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
  };
}
