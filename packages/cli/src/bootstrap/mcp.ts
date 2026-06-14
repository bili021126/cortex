/**
 * bootstrap/mcp.ts — MCP 后端初始化
 *
 * 从 main.ts 抽离的 MCP Server 加载与搜索聚合器引导逻辑。
 * 加载优先级：config/data/mcp-servers.json（新格式）→ cortex-agents.json searchProviders（旧格式）
 *
 * @module bootstrap/mcp
 */

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import {
  SearchAggregator,
  McpSearchBackend,
  DdgSearchBackend,
  type McpServerConfig,
  type Toolkit,
} from "@cortex/platform";
import {
  ENV_CORTEX_NO_SEARCH,
  ENV_VITEST,
  FILE_CORTEX_AGENTS_JSON,
  resolveConfigDataDir,
  loadConfigDomain,
  type McpServerEntry,
  type ConfigFileReader,
} from "@cortex/config";

/** MCP 引导结果——成功启动的后端列表 */
export interface McpBootstrapResult {
  /** 搜索聚合器（含 MCP + DDG 后端） */
  aggregator: SearchAggregator | null;
  /** 成功启动的 MCP 后端数 */
  startedCount: number;
}

/**
 * 初始化 MCP 后端与搜索聚合器。
 *
 * 设置 CORTEX_NO_SEARCH=1 可跳过整个初始化流程。
 */
/** 加载 MCP 服务端配置（优先新格式 mcpServers，回退旧格式 searchProviders） */
function _loadMcpConfigs(configRoot: string): McpServerConfig[] {
  // 1) 优先 mcpServers 域（config 包 data/mcp-servers.json）
  try {
    const dataDir = resolveConfigDataDir();
    const readFile: ConfigFileReader = (fp) => nodeFs.readFileSync(fp, "utf-8");
    const servers = loadConfigDomain<Record<string, McpServerEntry>>("mcpServers", readFile, dataDir);
    if (servers) {
      return Object.entries(servers)
        .filter(([key]) => !key.startsWith("_"))
        .map(([id, cfg]) => ({ id, ...cfg } as McpServerConfig))
        .filter((c) => c.enabled !== false);
    }
  } catch {
    // mcp-servers.json 缺失——回退 searchProviders
  }

  // 2) 回退 searchProviders（旧格式，从 cortex-agents.json 读取）
  const configPath = nodePath.join(configRoot, FILE_CORTEX_AGENTS_JSON);
  if (nodeFs.existsSync(configPath)) {
    const raw = JSON.parse(nodeFs.readFileSync(configPath, "utf-8"));
    const searchProviders = raw?.searchProviders;
    if (searchProviders?.backends && Array.isArray(searchProviders.backends)) {
      return (searchProviders.backends as McpServerConfig[])
        .filter((b) => b.enabled !== false);
    }
  }

  return [];
}

/** 启动 MCP 后端并构建搜索聚合器 */
async function _startMcpBackends(
  configs: McpServerConfig[],
  toolkit: Toolkit,
): Promise<McpBootstrapResult> {
  const ddgBackend = new DdgSearchBackend();
  const started: McpSearchBackend[] = [];

  for (const cfg of configs) {
    const backend = new McpSearchBackend({ ...cfg, env: {} });
    try {
      await backend.start();
      started.push(backend);
      toolkit.registerMcpClient(backend.getMcpClient());
      if (!process.env[ENV_VITEST]) {
        console.log(`[bootstrap] MCP 后端已连接: ${cfg.id} (${backend.serverName ?? cfg.id})`);
      }
    } catch (e) {
      if (!process.env[ENV_VITEST]) {
        console.warn(`[bootstrap] MCP 后端启动失败: ${cfg.id} — ${String(e)}`);
      }
    }
  }

  if (started.length > 0) {
    const aggregator = new SearchAggregator({ backends: [...started, ddgBackend] });
    toolkit.setSearchAggregator(aggregator);
    return { aggregator, startedCount: started.length };
  }

  return { aggregator: null, startedCount: 0 };
}

export async function bootstrapMcp(
  toolkit: Toolkit,
  configRoot: string,
): Promise<McpBootstrapResult> {
  if (process.env[ENV_CORTEX_NO_SEARCH] === "1") {
    return { aggregator: null, startedCount: 0 };
  }

  const mcpConfigs = _loadMcpConfigs(configRoot);
  if (mcpConfigs.length === 0) {
    return { aggregator: null, startedCount: 0 };
  }

  return await _startMcpBackends(mcpConfigs, toolkit);
}
