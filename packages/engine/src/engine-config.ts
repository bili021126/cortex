/**
 * EngineConfig —— 引擎运行时配置。
 *
 * 所有字段可选，未提供时走 DEFAULT_ENGINE_CONFIG。
 * 零行为变更：默认值与当前硬编码精确一致。
 *
 * @module engine-config
 * @layer root —— core / platform / bootstrap 共同依赖的中性配置层
 */

export interface EngineConfig {
  /** Agent ReAct 循环上限。默认 64 */
  defaultMaxLoops?: number;
  /** InspectorAgent ReAct 循环上限（降低以抑制幻觉风险）。默认 24 */
  inspectorMaxLoops?: number;
  /** 单节点最大重规划轮次。默认 3 */
  maxReplanPerNode?: number;
  /** 单次 executeAll 全局最大重规划次数。默认 3 */
  maxTotalReplans?: number;

  /** 工具执行超时 (ms) */
  toolTimeouts?: {
    /** search_code ripgrep 超时。默认 15_000 */
    searchCode?: number;
    /** run_shell 命令执行超时。默认 60_000 */
    runShell?: number;
    /** ConfirmGate 等待用户确认超时。默认 300_000 (5 分钟) */
    confirmWait?: number;
    /** web_search 搜索超时。默认 15_000 */
    webSearch?: number;
    /** web_search 最大重试次数（不含首次）。默认 2 */
    webSearchRetries?: number;
    /** web_search 缓存 TTL (ms)。默认 300_000 (5 分钟) */
    webSearchCacheTTL?: number;
  };

  /** InspectorAgent 编译/测试采集超时 (ms) */
  inspector?: {
    /** tsc --noEmit 超时。默认 30_000 */
    tscTimeout?: number;
    /** tsx 测试执行超时。默认 30_000 */
    testTimeout?: number;
    /** vitest 超时。默认 60_000 */
    vitestTimeout?: number;
  };

  /** 搜索后端配置 */
  search?: SearchConfig;
}

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

/** 默认引擎配置——所有值精确匹配当前源码硬编码 */
export const DEFAULT_ENGINE_CONFIG: Required<EngineConfig> = {
  defaultMaxLoops: 64,
  inspectorMaxLoops: 24,
  maxReplanPerNode: 3,
  maxTotalReplans: 3,

  toolTimeouts: {
    searchCode: 15_000,
    runShell: 60_000,
    confirmWait: 300_000,
    webSearch: 15_000,
    webSearchRetries: 2,
    webSearchCacheTTL: 300_000,
  },

  inspector: {
    tscTimeout: 30_000,
    testTimeout: 30_000,
    vitestTimeout: 60_000,
  },

  search: {
    backends: [],
    aggregation: {
      deduplicateBy: "url",
      resultTimeout: 10_000,
      minBackends: 1,
    },
  },
};

/**
 * 解析部分配置为全量配置。
 * 浅合并——嵌套对象的未提供字段会回退到默认值。
 */
export function resolveConfig(partial?: EngineConfig): Required<EngineConfig> {
  if (!partial) return DEFAULT_ENGINE_CONFIG;

  return {
    defaultMaxLoops: partial.defaultMaxLoops ?? DEFAULT_ENGINE_CONFIG.defaultMaxLoops,
    inspectorMaxLoops: partial.inspectorMaxLoops ?? DEFAULT_ENGINE_CONFIG.inspectorMaxLoops,
    maxReplanPerNode: partial.maxReplanPerNode ?? DEFAULT_ENGINE_CONFIG.maxReplanPerNode,
    maxTotalReplans: partial.maxTotalReplans ?? DEFAULT_ENGINE_CONFIG.maxTotalReplans,

    toolTimeouts: {
      searchCode:
        partial.toolTimeouts?.searchCode ?? DEFAULT_ENGINE_CONFIG.toolTimeouts.searchCode,
      runShell:
        partial.toolTimeouts?.runShell ?? DEFAULT_ENGINE_CONFIG.toolTimeouts.runShell,
      confirmWait:
        partial.toolTimeouts?.confirmWait ?? DEFAULT_ENGINE_CONFIG.toolTimeouts.confirmWait,
      webSearch:
        partial.toolTimeouts?.webSearch ?? DEFAULT_ENGINE_CONFIG.toolTimeouts.webSearch,
      webSearchRetries:
        partial.toolTimeouts?.webSearchRetries ?? DEFAULT_ENGINE_CONFIG.toolTimeouts.webSearchRetries,
      webSearchCacheTTL:
        partial.toolTimeouts?.webSearchCacheTTL ?? DEFAULT_ENGINE_CONFIG.toolTimeouts.webSearchCacheTTL,
    },

    inspector: {
      tscTimeout:
        partial.inspector?.tscTimeout ?? DEFAULT_ENGINE_CONFIG.inspector.tscTimeout,
      testTimeout:
        partial.inspector?.testTimeout ?? DEFAULT_ENGINE_CONFIG.inspector.testTimeout,
      vitestTimeout:
        partial.inspector?.vitestTimeout ?? DEFAULT_ENGINE_CONFIG.inspector.vitestTimeout,
    },

    search: {
      backends: partial.search?.backends ?? DEFAULT_ENGINE_CONFIG.search.backends,
      aggregation: {
        deduplicateBy: partial.search?.aggregation?.deduplicateBy ?? DEFAULT_ENGINE_CONFIG.search.aggregation.deduplicateBy,
        resultTimeout: partial.search?.aggregation?.resultTimeout ?? DEFAULT_ENGINE_CONFIG.search.aggregation.resultTimeout,
        minBackends: partial.search?.aggregation?.minBackends ?? DEFAULT_ENGINE_CONFIG.search.aggregation.minBackends,
      },
    },
  };
}
