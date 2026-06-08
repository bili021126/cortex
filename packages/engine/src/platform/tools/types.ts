// ============================================================
// @cortex/engine/platform/tools/types —— 工具工厂上下文
//
// 每个工具文件 export function createTool(ctx: ToolContext): Tool，
// toolkit.ts 遍历注册——统一 Map<string, Tool>，不区分本地/远程。
//
// @core v3 —— Tool 接口统一抽象
// ============================================================

import type { Tool, IFileSystemAdapter } from "@cortex/shared";

/**
 * 工具工厂依赖上下文。
 * 每个工具通过此接口访问 Toolkit 内部能力，
 * 不需要直接引用 Toolkit 实例（解耦）。
 */
export interface ToolContext {
  /** 路径安全解析（含沙箱越界检查） */
  resolvePath: (filePath: string) => string;
  /** 文件系统适配器 */
  fs: IFileSystemAdapter;
  /** 工作区根目录（null = 未限制） */
  workspaceRoot: string | null;
  /** 工具执行超时配置 */
  toolTimeouts: {
    searchCode?: number;
    runShell?: number;
    webSearch?: number;
    webSearchRetries?: number;
    webSearchCacheTTL?: number;
  };
  /** 联网搜索——委托给 SearchAggregator */
  searchWeb: (query: string, maxResults: number) => Promise<{ title: string; url: string; snippet: string }[]>;
}

/** 工具工厂——每个文件 export 一份 */
export type ToolFactory = (ctx: ToolContext) => Tool;
