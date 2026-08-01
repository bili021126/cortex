// ============================================================
// @cortex/engine/platform/tools/grep-files —— grep_files 工具
//
// 在指定的文件列表中搜索匹配行。与 search_code 不同：
// search_code 用 ripgrep 搜索整个项目，
// grep_files 在用户指定的文件列表中逐一搜索。
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================

import type { Tool } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
import type { ToolContext } from "./types.js";
import { ToolCategory, ReversibilityLevel as RL } from "@cortex/config";

export function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "grep_files",
    ToolCategory.Search,
    "Search for a pattern within a specific list of files. Unlike search_code (project-wide ripgrep), this searches only the exact files you specify. Returns file:line:content matches.",
    {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text or regex pattern to search for (case-insensitive)" },
        file_paths: {
          type: "array",
          items: { type: "string" },
          description: "Array of absolute file paths to search within (max 20)",
        },
      },
      required: ["pattern", "file_paths"],
    },
    RL.L0,
    async (params) => {
      const pattern = (params.pattern as string)?.toLowerCase();
      const paths = params.file_paths as string[];
      if (!pattern) {
        return { success: false, error: "grep_files 缺少 pattern 参数" };
      }
      if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return { success: false, error: "grep_files 需要 file_paths 数组参数" };
      }
      if (paths.length > 20) {
        return { success: false, error: `grep_files 最多搜索 20 个文件，收到 ${paths.length}` };
      }

      const matches: string[] = [];
      for (const rawPath of paths) {
        try {
          const filePath = ctx.resolvePath(rawPath);
          const exists = await ctx.fs.exists(filePath);
          if (!exists) continue;
          const content = await ctx.fs.readFile(filePath);
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            if (lines[i]!.toLowerCase().includes(pattern)) {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              matches.push(`${rawPath}:${i + 1}: ${lines[i]!.trim().slice(0, 300)}`);
            }
            if (matches.length >= 100) break;
          }
        } catch {
          // 跳过不可读文件
        }
        if (matches.length >= 100) break;
      }

      if (matches.length === 0) {
        return { success: true, output: `未在指定文件中找到匹配 "${params.pattern}" 的结果` };
      }
      return { success: true, output: matches.join("\n") };
    },
  );
}
