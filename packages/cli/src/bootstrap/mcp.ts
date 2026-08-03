/**
 * bootstrap/mcp.ts — MCP 后端初始化
 *
 * 从 main.ts 抽离的 MCP Server 加载与搜索聚合器引导逻辑。
 * 加载优先级：mcpServers 域（新格式）→ searchProviders 域（回退）
 *
 * @module bootstrap/mcp
 */

import * as nodeFs from "node:fs";
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
  /** R12-D5：停止全部 MCP stdio 子进程（CLI 退出时调用——防泄漏） */
  stopAll: () => Promise<void>;
}

/**
 * 初始化 MCP 后端与搜索聚合器。
 *
 * 设置 CORTEX_NO_SEARCH=1 可跳过整个初始化流程。
 */
/** 加载 MCP 服务端配置（优先 mcpServers 域，回退 searchProviders 域） */
function _loadMcpConfigs(): McpServerConfig[] {
  // 1) 优先 mcpServers 域（新格式）
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
    // mcpServers 域缺失——回退 searchProviders 域
  }

  // 2) 回退 searchProviders 域（旧 searchProviders 形态）
  try {
    const dataDir = resolveConfigDataDir();
    const readFile: ConfigFileReader = (fp) => nodeFs.readFileSync(fp, "utf-8");
    const sp = loadConfigDomain<{ providers?: { backends?: McpServerConfig[] } }>(
      "searchProviders",
      readFile,
      dataDir,
    );
    if (sp?.providers?.backends) {
      return sp.providers.backends.filter((b) => b.enabled !== false);
    }
  } catch {
    // searchProviders 域缺失——返回空
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
    return {
      aggregator,
      startedCount: started.length,
      // R12-D5：stopAll 接线——CLI 退出时停止全部 MCP stdio 子进程（此前 zero 调用——每次会话泄漏）
      stopAll: async () => {
        for (const b of started) {
          try { await b.stop(); } catch { /* 单个失败不阻断 */ }
        }
      },
    };
  }

  return { aggregator: null, startedCount: 0, stopAll: async () => {} };
}

export async function bootstrapMcp(
  toolkit: Toolkit,
): Promise<McpBootstrapResult> {
  if (process.env[ENV_CORTEX_NO_SEARCH] === "1") {
    return { aggregator: null, startedCount: 0, stopAll: async () => {} };
  }

  const mcpConfigs = _loadMcpConfigs();
  if (mcpConfigs.length === 0) {
    return { aggregator: null, startedCount: 0, stopAll: async () => {} };
  }

  return await _startMcpBackends(mcpConfigs, toolkit);
}
