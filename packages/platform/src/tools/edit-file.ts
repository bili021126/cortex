// ============================================================
// @cortex/engine/platform/tools/edit-file —— edit_file 工具
//
// 精确文本搜索替换——在文件中查找 old_text，替换为 new_text。
// 类似 Qoder 的 SearchReplace，比 write_file（全量覆盖）粒度更细。
//
// 校验规则：
//   1. old_text 必须在文件中唯一出现（除非 replace_all=true）
//   2. old_text 与 new_text 必须不同
//   3. 替换后文件长度 ≤ 1MB
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================

import { ToolCategory, ReversibilityLevel as RL, type Tool } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
import type { ToolContext } from "./types.js";

export function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "edit_file",
    ToolCategory.Write,
    "Perform a precise search-and-replace in a file. Finds the exact old_text string and replaces it with new_text. Unlike write_file (full overwrite), this only touches the matched portion. Use replace_all=true to replace all occurrences.",
    {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the file to edit",
        },
        old_text: {
          type: "string",
          description: "The exact text to find and replace. Must be unique in the file unless replace_all is true.",
        },
        new_text: {
          type: "string",
          description: "The replacement text. Must differ from old_text.",
        },
        replace_all: {
          type: "boolean",
          description: "If true, replace all occurrences of old_text (default: false)",
        },
      },
      required: ["file_path", "old_text", "new_text"],
    },
    RL.L2,
    async (params) => {
      const filePath = ctx.resolvePath(params.file_path as string);
      const oldText = params.old_text as string;
      const newText = params.new_text as string;
      const replaceAll = params.replace_all === true;

      if (!oldText) {
        return { success: false, error: "edit_file: old_text 不能为空" };
      }
      if (oldText === newText) {
        return { success: false, error: "edit_file: old_text 与 new_text 不能相同" };
      }

      try {
        const exists = await ctx.fs.exists(filePath);
        if (!exists) {
          return { success: false, error: `文件不存在: ${filePath}` };
        }

        const content = await ctx.fs.readFile(filePath);

        // 计算出现次数
        const occurrences = countOccurrences(content, oldText);
        if (occurrences === 0) {
          return {
            success: false,
            error: `edit_file: 在 "${filePath}" 中未找到 old_text。请确认文本精确匹配（含空白字符）。`,
          };
        }
        if (!replaceAll && occurrences > 1) {
          const preview = content.slice(
            Math.max(0, content.indexOf(oldText) - 40),
            content.indexOf(oldText) + oldText.length + 40,
          );
          return {
            success: false,
            error: `edit_file: old_text 在文件中出现了 ${occurrences} 次，但 replace_all=false。` +
              `请提供更多上下文使 old_text 唯一，或设置 replace_all=true。` +
              `\n首次出现附近: ...${preview}...`,
          };
        }

        // 执行替换
        const newContent = replaceAll
          ? content.split(oldText).join(newText)
          : content.replace(oldText, newText);

        if (newContent.length > 1_048_576) {
          return { success: false, error: `edit_file: 替换后文件超过 1MB 限制 (${newContent.length} bytes)` };
        }

        await ctx.fs.writeFile(filePath, newContent);

        const replacedCount = replaceAll ? occurrences : 1;
        return {
          success: true,
          output: `edit_file OK: ${filePath}\n替换 ${replacedCount} 处，${content.length} → ${newContent.length} 字符`,
        };
      } catch (e) {
        return { success: false, error: `edit_file 失败: ${String(e)}` };
      }
    },
  );
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}
