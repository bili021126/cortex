// ============================================================
// @cortex/engine/platform/tools/web-search —— web_search 工具
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================

import { ToolCategory, ReversibilityLevel as RL, type Tool } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
import type { ToolContext } from "./types.js";

export function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "web_search",
    ToolCategory.Search,
    "Search the web and return structured results.",
    {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "number", description: "Maximum number of results (default: 5, max: 10)" },
      },
      required: ["query"],
    },
    RL.L0,
    async (params) => {
      const query = params.query as string;
      if (!query?.trim()) {
        return { success: false, error: "web_search 缺少 query 参数" };
      }
      const maxResults = Math.min(params.max_results as number ?? 5, 10);
      try {
        const results = await ctx.searchWeb(query.trim(), maxResults);
        if (results.length === 0) {
          return {
            success: true,
            output: JSON.stringify({ query: query.trim(), results: [], note: "未找到搜索结果" }),
          };
        }
        return {
          success: true,
          output: JSON.stringify({ query: query.trim(), count: results.length, results }),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: `搜索失败: ${msg}` };
      }
    },
  );
}
