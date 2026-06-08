/**
 * @cortex/config — 可插拔配置加载器
 *
 * 核心设计理念：
 *   1. 域注册（Domain Registry）—— 每个配置域独立声明文件名、是否必需、数据键名
 *   2. 懒加载（Lazy Load）—— 按需加载单个域，不必一次性全量
 *   3. 可插拔（Pluggable）—— 新增配置域只需添加一个 ConfigDomain 条目
 *   4. 文件系统无关（FS-Agnostic）—— 调用方提供 readFile 实现，解耦 Node/Browser
 *
 * 使用示例：
 * ```typescript
 * import { loadConfigDomain, loadAllConfig, getConfigDataPath } from "@cortex/config";
 *
 * // 加载全部配置
 * const config = loadAllConfig(readFileSync, getConfigDataPath());
 *
 * // 按需加载单个域
 * const agents = loadConfigDomain("agents", readFileSync, getConfigDataPath());
 * ```
 *
 * @module loader
 * @layer root — 零运行时依赖（仅 fs 类型）
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentsConfig } from "./interfaces/agent.js";
import type { EngineConfig } from "./interfaces/engine.js";
import type { EventRoutingConfig } from "./interfaces/event-routing.js";
import type { RoundtableTemplate } from "./interfaces/roundtable.js";
import type { SearchProviderConfig, SearchAggregationConfig, McpServerEntry } from "./interfaces/search.js";
import type { SelfExaminationConfig } from "./interfaces/self-examination.js";
import type { CrossVerificationConfig } from "./interfaces/cross-verification.js";
import type { SeedMemoriesConfig } from "./interfaces/seed-memory.js";
import type { GovernancePipelineConfig } from "./interfaces/governance.js";
import type { CognitionConfig } from "./interfaces/cognition.js";
import type { DocsConfig } from "./interfaces/docs.js";
import type { ToolRegistry } from "./interfaces/tool.js";

// ─── 域注册 ───────────────────────────────────────────

/**
 * 配置域描述符——注册一个配置域所需的元信息。
 * 新增配置域只需在 CONFIG_DOMAINS 数组添加一项即可。
 */
export interface ConfigDomain {
  /** 域标识（如 "agents", "engine"） */
  name: string;
  /** JSON 文件名（如 "agents.json"） */
  fileName: string;
  /** 是否必需——若为 true，文件缺失时报错 */
  required: boolean;
  /** JSON 中承载数据的顶层 key（如 "agents"），undefined 表示整个 JSON 即为数据 */
  dataKey?: string;
  /** 域描述（人类可读） */
  description: string;
}

/**
 * 所有配置域的注册表——可插拔。
 * 新增域时只需添加一项，无需修改任何其他代码。
 */
export const CONFIG_DOMAINS: ConfigDomain[] = [
  {
    name: "agents",
    fileName: "agents.json",
    required: true,
    dataKey: "agents",
    description: "Agent 定义集合——每个 Agent 的完整声明",
  },
  {
    name: "engine",
    fileName: "engine.json",
    required: false,
    description: "引擎运行时参数——循环上限、超时、Inspector 配置",
  },
  {
    name: "tools",
    fileName: "tools.json",
    required: false,
    dataKey: "tools",
    description: "工具元数据定义——每把工具的声明式描述",
  },
  {
    name: "eventRouting",
    fileName: "event-routing.json",
    required: true,
    description: "事件路由配置——四通道物理分层与委员会召集规则",
  },
  {
    name: "roundtable",
    fileName: "roundtable.json",
    required: false,
    dataKey: "templates",
    description: "圆桌会议模板列表——多 Agent 协作审议模板",
  },
  {
    name: "searchProviders",
    fileName: "search-providers.json",
    required: false,
    description: "搜索后端与聚合配置——可插拔 MCP 搜索提供商（旧格式，已拆分 mcpServers）",
  },
  {
    name: "mcpServers",
    fileName: "mcp-servers.json",
    required: false,
    dataKey: "servers",
    description: "MCP Server 配置——对齐行业标准 mcpServers 格式",
  },
  {
    name: "selfExamination",
    fileName: "self-examination.json",
    required: false,
    description: "自审视脚本配置——hard/soft 模式独立配置",
  },
  {
    name: "crossVerification",
    fileName: "cross-verification.json",
    required: false,
    dataKey: "pairs",
    description: "交叉验证配对表——报告与验证者配对",
  },
  {
    name: "seedMemories",
    fileName: "seed-memories.json",
    required: false,
    dataKey: "entries",
    description: "种子记忆——MemoryStore 初始化写入",
  },
  {
    name: "governancePipeline",
    fileName: "governance-pipeline.json",
    required: false,
    description: "治理管线配置——制度制度化的运行引擎",
  },
  {
    name: "cognition",
    fileName: "cognition.json",
    required: false,
    description: "认知配置——Agent 激活矩阵与注意力策略",
  },
  {
    name: "docs",
    fileName: "docs.json",
    required: false,
    description: "文档配置——宪法路径与文档注册表",
  },
];

// ─── 文件读取器类型 ────────────────────────────────────

/** 文件读取函数签名——调用方提供实现（Node: fs.readFileSync, Browser: fetch） */
export type ConfigFileReader = (filePath: string) => string;

// ─── 错误类型 ──────────────────────────────────────────

/** 配置加载错误 */
export class ConfigLoadError extends Error {
  constructor(
    message: string,
    public readonly domainName: string,
    public readonly cause?: unknown,
  ) {
    super(`[config/${domainName}] ${message}`);
    this.name = "ConfigLoadError";
  }
}

/** 配置校验错误 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly domainName: string,
  ) {
    super(`[config/${domainName}] ${message}`);
    this.name = "ConfigValidationError";
  }
}

// ─── 路径工具 ──────────────────────────────────────────

/**
 * 解析 config 包的 data 目录绝对路径。
 *
 * 在 monorepo 环境中，通过 import.meta.url 推导 dist/data/ 路径。
 * 结果会被缓存，后续调用直接返回。
 *
 * @returns data 目录的绝对路径
 * @throws ConfigLoadError 若无法解析（非 Node.js ESM 环境）
 */
export function resolveConfigDataDir(): string {
  if (_cachedDataDir) return _cachedDataDir;

  try {
    // 从 dist/loader.js 推导：dist/loader.js → dist/ → dist/data/
    const distDir = path.dirname(fileURLToPath(import.meta.url));
    const resolved = path.join(distDir, "data");
    _cachedDataDir = resolved;
    return resolved;
  } catch {
    throw new ConfigLoadError(
      "无法解析 config data 目录。请确保在 Node.js ESM 环境中运行，或显式传入 dataDir 参数。",
      "loader",
    );
  }
}

/** 缓存已解析的 data 目录路径 */
let _cachedDataDir: string | null = null;

/**
 * 获取 config 包 data 目录的绝对路径（推荐方式）。
 *
 * 在 Node.js 环境中通过 import.meta.url 推导，
 * 调用方也可以直接构造路径传入。
 *
 * @param importMetaUrl 调用方的 import.meta.url（用于路径推导）
 * @returns data 目录的绝对路径
 * @deprecated 推荐使用 resolveConfigDataDir()，无需传参
 */
export function getConfigDataPath(importMetaUrl?: string): string {
  if (importMetaUrl) {
    const url = new URL(importMetaUrl);
    if (url.protocol === "file:") {
      let dirPath = url.pathname;
      const lastSlash = dirPath.lastIndexOf("/");
      if (lastSlash !== -1) {
        dirPath = dirPath.substring(0, lastSlash);
      }
      return `${dirPath}/../data`;
    }
  }
  return resolveConfigDataDir();
}

// ─── 加载器核心 ────────────────────────────────────────

/**
 * 加载单个配置域。
 *
 * @param domainName 域标识（如 "agents"）
 * @param readFile 文件读取函数
 * @param dataDir data 目录的绝对路径
 * @returns 解析后的配置数据
 * @throws ConfigLoadError 若文件缺失（必需域）或 JSON 解析失败
 * @throws ConfigValidationError 若数据结构校验失败
 */
export function loadConfigDomain<T = unknown>(
  domainName: string,
  readFile: ConfigFileReader,
  dataDir: string,
): T {
  const domain = CONFIG_DOMAINS.find((d) => d.name === domainName);
  if (!domain) {
    throw new ConfigLoadError(
      `未知的配置域 "${domainName}"。有效域: ${CONFIG_DOMAINS.map((d) => d.name).join(", ")}`,
      domainName,
    );
  }

  const filePath = `${dataDir}/${domain.fileName}`;

  let raw: string;
  try {
    raw = readFile(filePath);
  } catch (e) {
    if (domain.required) {
      throw new ConfigLoadError(
        `必需配置文件不存在: ${filePath}`,
        domainName,
        e,
      );
    }
    // 可选域文件缺失返回 undefined，让调用方自行处理默认值
    return undefined as T;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigLoadError(
      `JSON 解析失败: ${filePath}: ${String(e)}`,
      domainName,
      e,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ConfigValidationError(
      `配置文件 ${filePath} 顶层必须为对象`,
      domainName,
    );
  }

  const data = parsed as Record<string, unknown>;

  // 如果有 dataKey，提取键值；否则返回整个对象
  if (domain.dataKey) {
    if (!(domain.dataKey in data)) {
      throw new ConfigValidationError(
        `配置文件 ${filePath} 缺少 "${domain.dataKey}" 字段`,
        domainName,
      );
    }
    return data[domain.dataKey] as T;
  }

  return data as T;
}

/**
 * 加载所有已注册的配置域。
 * 必需域缺失会抛出错误，可选域缺失静默跳过。
 *
 * @param readFile 文件读取函数
 * @param dataDir data 目录的绝对路径
 * @returns 全量配置对象
 */
export function loadAllConfig(
  readFile: ConfigFileReader,
  dataDir: string,
): CortexConfig {
  const config: CortexConfig = {};

  for (const domain of CONFIG_DOMAINS) {
    try {
      config[domain.name] = loadConfigDomain(domain.name, readFile, dataDir);
    } catch (e) {
      if (domain.required) {
        throw e;
      }
      // 可选域缺失——静默跳过
    }
  }

  return config;
}

// ─── 全量配置类型 ──────────────────────────────────────

/** 全量 Cortex 配置——按域索引 */
export interface CortexConfig {
  agents?: AgentsConfig;
  engine?: EngineConfig;
  tools?: ToolRegistry;
  eventRouting?: EventRoutingConfig;
  roundtable?: RoundtableTemplate[];
  searchProviders?: {
    backends: SearchProviderConfig[];
    aggregation: SearchAggregationConfig;
  };
  mcpServers?: Record<string, McpServerEntry>;
  selfExamination?: SelfExaminationConfig;
  crossVerification?: CrossVerificationConfig;
  seedMemories?: SeedMemoriesConfig;
  governancePipeline?: GovernancePipelineConfig;
  cognition?: CognitionConfig;
  docs?: DocsConfig;
  [key: string]: unknown;
}
