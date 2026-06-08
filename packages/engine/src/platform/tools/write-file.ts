// ============================================================
// @cortex/engine/platform/tools/write-file —— write_file 工具
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================

import { ToolCategory, ReversibilityLevel as RL, type Tool } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
import type { ToolContext } from "./types.js";

export function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "write_file",
    ToolCategory.Write,
    "Write content to a file at the given path.",
    {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to file" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["file_path", "content"],
    },
    RL.L2,
    async (params) => {
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
    },
    { needsLock: true },
  );
}
