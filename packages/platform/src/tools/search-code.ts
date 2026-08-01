// ============================================================
// @cortex/engine/platform/tools/search-code —— search_code 工具
//
// 使用 ripgrep 优先，不可用时退回 Node.js 原生 grep。
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================

import type { Tool, DirectoryEntry } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
import type { ToolContext } from "./types.js";
import { ToolCategory, ReversibilityLevel as RL } from "@cortex/config";

export function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "search_code",
    ToolCategory.Search,
    "Search for code patterns in the project.",
    {
      type: "object",
      properties: {
        query: { type: "string", description: "Code pattern to search" },
      },
      required: ["query"],
    },
    RL.L0,
    async (params) => {
      const query = params.query as string;
      if (!query) {
        return { success: false, error: "search_code 缺少 query 参数" };
      }
      try {
        const searchRoot = ctx.workspaceRoot ?? ctx.fs.cwd();
        let output: string;
        let fallbackError: string | null = null;
        try {
          output = await ctx.fs.execFile(
            "rg",
            ["--line-number", "--max-count", "30", "--no-heading", query],
            { cwd: searchRoot, timeout: ctx.toolTimeouts.searchCode },
          );
        } catch (e) {
          const err = e as { status?: number; stderr?: unknown; message?: string };
          const stderr = err.stderr?.toString() ?? "";
          if (err.status === 1) {
            // 无匹配，rg 正常工作
            output = "";
          } else if (process.platform === "win32") {
            // Windows: rg 不可用时直接返回错误，不走 grep 回退（grep 遍历目录树耗时 35-47s，会耗尽 ReAct 预算）
            return { success: false, error: "search_code: rg 不可用。请使用 list_files 列出目录 + read_file 读取具体文件。" };
          } else {
            if (!process.env.VITEST) {
              console.warn(
                `[toolkit] search_code: rg failed (exit ${err.status ?? "?"}), falling back to grep. stderr: ${stderr.slice(0, 200)}`,
              );
            }
            try {
              output = await grepFallback(ctx, searchRoot, query);
            } catch (fallbackErr) {
              fallbackError = `grep fallback failed: ${String(fallbackErr)}`;
              output = "";
            }
          }
        }
        if (!output.trim()) {
          const msg = fallbackError
            ? `搜索失败: rg 不可用且 grep 降级也失败 (${fallbackError})`
            : `未找到匹配 "${query}" 的结果`;
          return { success: true, output: msg };
        }
        return { success: true, output: output.slice(0, 10_000) };
      } catch (e) {
        return { success: false, error: `搜索失败: ${String(e)}` };
      }
    },
  );
}

/**
 * 简易 grep 回退（rg 不可用时的纯 Node.js 文本搜索）。
 * 从 Toolkit._grepFallback 提取为独立工具函数。
 */
async function grepFallback(ctx: ToolContext, rootDir: string, query: string): Promise<string> {
  const results: string[] = [];
  const lowerQuery = query.toLowerCase();
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4 || results.length > 30) return;
    let entries: DirectoryEntry[];
    try {
      entries = await ctx.fs.listDirectory(dir);
    } catch (e) {
      console.warn(`[toolkit] readdir failed for ${dir}: ${String(e)}`);
      return;
    }
    for (const entry of entries) {
      if (results.length >= 30) return;
      const fullPath = ctx.fs.resolve(dir, entry.name);
      if (entry.isDirectory) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "dist") {
          await walk(fullPath, depth + 1);
        }
      } else if (/\.(ts|js|json|md|html|css)$/.test(entry.name)) {
        try {
          const content = await ctx.fs.readFile(fullPath);
          const lines = content.split("\n");
          for (let i = 0; i < lines.length && results.length < 30; i++) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            if (lines[i]!.toLowerCase().includes(lowerQuery)) {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              results.push(`${fullPath}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
            }
          }
        } catch (e) {
          console.warn(`[toolkit] skip unreadable file ${fullPath}: ${String(e)}`);
        }
      }
    }
  };
  await walk(rootDir, 0);
  return results.join("\n");
}
