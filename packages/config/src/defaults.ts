/**
 * @cortex/config — 默认配置值与解析逻辑
 *
 * DEFAULT_ENGINE_CONFIG 是唯一真相源——所有值精确匹配当前系统行为。
 * resolveConfig() 将部分配置与默认值合并，未提供字段回退到默认。
 *
 * @module defaults
 * @layer root
 */

import type {
  EngineConfig,
} from "./interfaces.js";

/** 默认引擎配置——所有值精确匹配当前系统行为 */
export const DEFAULT_ENGINE_CONFIG: Required<EngineConfig> = {
  defaultMaxLoops: 64,
  inspectorMaxLoops: 48,
  maxReplanPerNode: 3,
  maxTotalReplans: 3,
  executeAllTimeoutMs: 600_000,
  reactLoopTimeoutMs: 300_000,

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

  llm: {
    baseUrl: "https://api.deepseek.com/v1",
    chatModel: "deepseek-chat",
    reasonerModel: "deepseek-reasoner",
  },

  filePaths: {
    skillRegistry: "skill-registry.json",
    codingStandards: "prompts/coding-standards.md",
    hashCache: "file-hashes.json",
  },

  skillSystem: {
    defaultTimeoutMs: 30_000,
    maxRetries: 0,
  },
};

// ─── 嵌套对象合并辅助 ───────────────────────────────

function mergeToolTimeouts(
  partial?: EngineConfig["toolTimeouts"],
): Required<EngineConfig>["toolTimeouts"] {
  return {
    searchCode: partial?.searchCode ?? DEFAULT_ENGINE_CONFIG.toolTimeouts.searchCode,
    runShell: partial?.runShell ?? DEFAULT_ENGINE_CONFIG.toolTimeouts.runShell,
    confirmWait: partial?.confirmWait ?? DEFAULT_ENGINE_CONFIG.toolTimeouts.confirmWait,
    webSearch: partial?.webSearch ?? DEFAULT_ENGINE_CONFIG.toolTimeouts.webSearch,
    webSearchRetries: partial?.webSearchRetries ?? DEFAULT_ENGINE_CONFIG.toolTimeouts.webSearchRetries,
    webSearchCacheTTL: partial?.webSearchCacheTTL ?? DEFAULT_ENGINE_CONFIG.toolTimeouts.webSearchCacheTTL,
  };
}

function mergeInspector(
  partial?: EngineConfig["inspector"],
): Required<EngineConfig>["inspector"] {
  return {
    tscTimeout: partial?.tscTimeout ?? DEFAULT_ENGINE_CONFIG.inspector.tscTimeout,
    testTimeout: partial?.testTimeout ?? DEFAULT_ENGINE_CONFIG.inspector.testTimeout,
    vitestTimeout: partial?.vitestTimeout ?? DEFAULT_ENGINE_CONFIG.inspector.vitestTimeout,
  };
}

function mergeSearch(
  partial?: EngineConfig["search"],
): Required<EngineConfig>["search"] {
  return {
    backends: partial?.backends ?? [...DEFAULT_ENGINE_CONFIG.search.backends],
    aggregation: {
      deduplicateBy: partial?.aggregation?.deduplicateBy ?? DEFAULT_ENGINE_CONFIG.search.aggregation.deduplicateBy,
      resultTimeout: partial?.aggregation?.resultTimeout ?? DEFAULT_ENGINE_CONFIG.search.aggregation.resultTimeout,
      minBackends: partial?.aggregation?.minBackends ?? DEFAULT_ENGINE_CONFIG.search.aggregation.minBackends,
    },
  };
}

function mergeLlm(
  partial?: EngineConfig["llm"],
): Required<EngineConfig>["llm"] {
  return {
    baseUrl: partial?.baseUrl ?? DEFAULT_ENGINE_CONFIG.llm.baseUrl,
    chatModel: partial?.chatModel ?? DEFAULT_ENGINE_CONFIG.llm.chatModel,
    reasonerModel: partial?.reasonerModel ?? DEFAULT_ENGINE_CONFIG.llm.reasonerModel,
  };
}

function mergeFilePaths(
  partial?: EngineConfig["filePaths"],
): Required<EngineConfig>["filePaths"] {
  return {
    skillRegistry: partial?.skillRegistry ?? DEFAULT_ENGINE_CONFIG.filePaths.skillRegistry,
    codingStandards: partial?.codingStandards ?? DEFAULT_ENGINE_CONFIG.filePaths.codingStandards,
    hashCache: partial?.hashCache ?? DEFAULT_ENGINE_CONFIG.filePaths.hashCache,
  };
}

function mergeSkillSystem(
  partial?: EngineConfig["skillSystem"],
): Required<EngineConfig>["skillSystem"] {
  return {
    defaultTimeoutMs: partial?.defaultTimeoutMs ?? DEFAULT_ENGINE_CONFIG.skillSystem.defaultTimeoutMs,
    maxRetries: partial?.maxRetries ?? DEFAULT_ENGINE_CONFIG.skillSystem.maxRetries,
  };
}

// ─── 公开 API ──────────────────────────────────────

/**
 * 解析部分配置为全量配置。
 * 浅合并——嵌套对象的未提供字段回退到默认值。
 * 数组/对象默认值使用展开副本，防止调用方误修改全局默认值。
 */
export function resolveConfig(partial?: EngineConfig): Required<EngineConfig> {
  if (!partial) {
    return {
      ...DEFAULT_ENGINE_CONFIG,
      toolTimeouts: { ...DEFAULT_ENGINE_CONFIG.toolTimeouts },
      inspector: { ...DEFAULT_ENGINE_CONFIG.inspector },
      search: { ...DEFAULT_ENGINE_CONFIG.search, backends: [...DEFAULT_ENGINE_CONFIG.search.backends] },
      llm: { ...DEFAULT_ENGINE_CONFIG.llm },
      filePaths: { ...DEFAULT_ENGINE_CONFIG.filePaths },
      skillSystem: { ...DEFAULT_ENGINE_CONFIG.skillSystem },
    };
  }

  return {
    defaultMaxLoops: partial.defaultMaxLoops ?? DEFAULT_ENGINE_CONFIG.defaultMaxLoops,
    inspectorMaxLoops: partial.inspectorMaxLoops ?? DEFAULT_ENGINE_CONFIG.inspectorMaxLoops,
    maxReplanPerNode: partial.maxReplanPerNode ?? DEFAULT_ENGINE_CONFIG.maxReplanPerNode,
    maxTotalReplans: partial.maxTotalReplans ?? DEFAULT_ENGINE_CONFIG.maxTotalReplans,
    executeAllTimeoutMs: partial.executeAllTimeoutMs ?? DEFAULT_ENGINE_CONFIG.executeAllTimeoutMs,
    reactLoopTimeoutMs: partial.reactLoopTimeoutMs ?? DEFAULT_ENGINE_CONFIG.reactLoopTimeoutMs,

    toolTimeouts: mergeToolTimeouts(partial.toolTimeouts),
    inspector: mergeInspector(partial.inspector),
    search: mergeSearch(partial.search),
    llm: mergeLlm(partial.llm),
    filePaths: mergeFilePaths(partial.filePaths),
    skillSystem: mergeSkillSystem(partial.skillSystem),
  };
}
