/**
 * bootstrap/mcp.ts — MCP 后端初始化
 *
 * 从 main.ts 抽离的 MCP Server 加载与搜索聚合器引导逻辑。
 * 加载优先级：config/data/mcp-servers.json（新格式）→ cortex-agents.json searchProviders（旧格式）
 *
 * @module bootstrap/mcp
 */
import { SearchAggregator, type Toolkit } from "@cortex/platform";
/** MCP 引导结果——成功启动的后端列表 */
export interface McpBootstrapResult {
    /** 搜索聚合器（含 MCP + DDG 后端） */
    aggregator: SearchAggregator | null;
    /** 成功启动的 MCP 后端数 */
    startedCount: number;
}
export declare function bootstrapMcp(toolkit: Toolkit, configRoot: string): Promise<McpBootstrapResult>;
//# sourceMappingURL=mcp.d.ts.map