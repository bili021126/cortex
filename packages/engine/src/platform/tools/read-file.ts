// ============================================================
// @cortex/engine/platform/tools/read-file —— read_file 工具 Handler
// ============================================================

import type { ToolMeta } from "../toolkit.js";
import type { ToolContext } from "./types.js";
import type { ToolHandler } from "@cortex/shared";
import { ToolCategory } from "@cortex/shared";
import { ReversibilityLevel as RL } from "@cortex/shared";

export const meta: ToolMeta = {
  category: ToolCategory.Read,
  description: "Read the contents of a file at the given path.",
  level: RL.L0,
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path to file" },
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
      const content = await ctx.fs.readFile(filePath);
      return { success: true, output: content };
    } catch (e) {
      return { success: false, error: `读取失败: ${String(e)}` };
    }
  };
}
