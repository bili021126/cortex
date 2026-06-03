// ============================================================
// @cortex/engine/platform/tools/write-file —— write_file 工具 Handler
// ============================================================

import type { ToolMeta } from "../toolkit.js";
import type { ToolContext } from "./types.js";
import type { ToolHandler } from "@cortex/shared";
import { ToolCategory } from "@cortex/shared";
import { ReversibilityLevel as RL } from "@cortex/shared";

export const meta: ToolMeta = {
  category: ToolCategory.Write,
  description: "Write content to a file at the given path.",
  level: RL.L2,
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path to file" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["file_path", "content"],
  },
  required: ["file_path", "content"],
};

export function createHandler(ctx: ToolContext): ToolHandler {
  return async (params) => {
    const filePath = ctx.resolvePath(params.file_path as string);
    const content = params.content as string;
    if (content === undefined) {
      return { success: false, error: "write_file 缺少 content 参数" };
    }
    try {
      await ctx.fs.writeFile(filePath, content);
      return { success: true, output: `已写入 ${filePath} (${content.length} 字符)` };
    } catch (e) {
      return { success: false, error: `写入失败: ${String(e)}` };
    }
  };
}
