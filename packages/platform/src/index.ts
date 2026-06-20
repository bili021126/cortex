// ============================================================
// @cortex/platform —— 引擎平台层独立包
//
// v2.6.6: 从 @cortex/engine 拆出为独立包。
// engine 通过 barrel 重导出保持向后兼容。
// ============================================================

// ── 核心工具 ───────────────────────────────────
export { Toolkit } from "./toolkit.js";
export type { ToolMeta } from "./toolkit.js";
export { FileLockManager } from "./file-lock-manager.js";
export { CLIAdapter } from "./cli-adapter.js";
export { NodeFileSystemAdapter } from "./node-fs-adapter.js";
export { validatePath, resolveSafePath } from "./path-utils.js";
export type { PathValidationResult } from "./path-utils.js";

// ── 搜索 ───────────────────────────────────────
export { SearchAggregator } from "./search-aggregator.js";
export { McpSearchBackend, DdgSearchBackend } from "./search-backend.js";
export type { SearchBackend, SearchResult } from "./search-backend.js";

// ── 上下文压缩 ────────────────────────────────
export { compressContent, extractFindings, compressForRoundtable } from "./context-compressor.js";
export type { CompressionLevel, CompressedReport, ReportStats, RoundtableCompressInput } from "./context-compressor.js";

// ── MCP 客户端 ─────────────────────────────────
export { McpClient, McpToolAdapter, MCP_PREFIX } from "./mcp-client.js";
export type { McpServerConfig, McpToolDef, McpTrustConfig } from "./mcp-client.js";

// ── 本地工具适配 ──────────────────────────────
export { LocalTool } from "./local-tool.js";

// ── 工具类型（从 tools/types.ts 导出） ────────
export type { ToolContext } from "./tools/types.js";
