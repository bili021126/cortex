/**
 * @cortex/config — 搜索后端配置接口
 *
 * @module interfaces/search
 * @layer root — 零依赖，纯类型层
 */

/** MCP 搜索后端配置 */
export interface SearchProviderConfig {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  timeout?: number;
}

/** 搜索聚合配置 */
export interface SearchAggregationConfig {
  deduplicateBy: "url";
  resultTimeout: number;
  minBackends: number;
}

/** 搜索配置 */
export interface SearchConfig {
  backends: SearchProviderConfig[];
  aggregation: SearchAggregationConfig;
}

// ── MCP Server ─────────────────────────────────

/** MCP 传输类型 */
export type McpTransport = "stdio" | "http";

/** 单个 MCP Server 条目——对齐行业标准 mcpServers 配置格式 */
export interface McpServerEntry {
  /** 传输类型——"stdio" 启动子进程，"http" 连接远程端点。默认 "stdio" */
  transport?: McpTransport;
  /** 启动命令（stdio 传输必填） */
  command?: string;
  /** 命令参数 */
  args?: string[];
  /** 子进程环境变量 */
  env?: Record<string, string>;
  /** 子进程工作目录 */
  cwd?: string;
  /** HTTP 端点 URL（HTTP 传输必填） */
  url?: string;
  /** HTTP 请求头 */
  headers?: Record<string, string>;
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 单次 tool call 超时 (ms), 默认 15000 */
  timeout?: number;
}

/** MCP Server 集合——key 为 serverId */
export interface McpServersConfig {
  servers: Record<string, McpServerEntry>;
}

/** 输出格式 */
export const OUTPUT_FORMATS = ["text", "json", "color"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
