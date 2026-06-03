// ============================================================
// @cortex/engine/platform/tools/types —— 工具 Handler 工厂上下文
//
// 每个工具文件 export { meta, createHandler }，
// toolkit.ts 遍历注册——做白名单过滤 + ConfirmGate 拦截。
// ============================================================

import type { ToolMeta } from "../toolkit.js";
import type { ToolHandler, IFileSystemAdapter } from "@cortex/shared";

/**
 * 工具 Handler 工厂依赖上下文。
 * 每个工具 handler 通过此接口访问 Toolkit 内部能力，
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

/** 工具注册项——每个文件 export 一份 */
export interface ToolEntry {
  meta: ToolMeta;
  createHandler: (ctx: ToolContext) => ToolHandler;
}
