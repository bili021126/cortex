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
import type { AgentManifestConfig } from "./interfaces/agent-manifest.js";
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
import type { ModelEntry } from "./interfaces/model.js";
import type { KeysContextConfig } from "./interfaces/key-context.js";
import type { TuningConfig } from "./interfaces/tuning.js";
import {
  MODELS_SCHEMA,
  KEYS_CONTEXT_SCHEMA,
  AGENT_MANIFEST_SCHEMA,
  TUNING_SCHEMA,
  TOOLS_SCHEMA,
  EVENT_ROUTING_SCHEMA,
  ENGINE_SCHEMA,
  ENGINE_PLUGINS_SCHEMA,
  ROUNDTABLE_SCHEMA,
  COGNITION_SCHEMA,
  DOCS_SCHEMA,
  MCP_SERVERS_SCHEMA,
  SELF_EXAMINATION_SCHEMA,
  CROSS_VERIFICATION_SCHEMA,
  SEED_MEMORIES_SCHEMA,
  GOVERNANCE_PIPELINE_SCHEMA,
} from "./schemas/index.js";

// ─── 域注册 ───────────────────────────────────────────

/** JSON Schema 类型——轻量级无依赖实现（Draft-07 子集） */
export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "boolean" | "null" | "integer";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  enum?: (string | number | boolean)[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  description?: string;
  $ref?: string;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  /** 自定义消息——schema 校验失败时使用 */
  _message?: string;
  /** 嵌套 property path→schema 引用 */
  _properties?: Record<string, JsonSchema>;
}

/**
 * 配置域描述符——注册一个配置域所需的元信息。
 * 新增配置域只需在 CONFIG_DOMAINS 数组添加一项即可。
 * B5：与 ConfigRegistry 统一——defaults/envPrefix 为运行时注册字段。
 */
export interface ConfigDomain {
  /** 域标识（如 "agents", "engine"）——registry 的 key 即此值 */
  name: string;
  /** JSON 文件名（如 "agents.json"） */
  fileName: string;
  /** 是否必需——若为 true，文件缺失时报错 */
  required: boolean;
  /** JSON 中承载数据的顶层 key（如 "agents"），undefined 表示整个 JSON 即为数据 */
  dataKey?: string;
  /** JSON Schema 校验——若提供，加载后和数据写入前均强制执行 */
  schema?: JsonSchema;
  /** 域描述（人类可读） */
  description: string;
  /** 运行时默认值（ConfigRegistry.get 返回）——B5 统一字段 */
  defaults?: Record<string, unknown>;
  /** 环境变量前缀（如 "CORTEX_ENGINE_"）——B5 统一字段，Resolver 预留 */
  envPrefix?: string;
}

/**
 * 所有配置域的注册表——可插拔。
 * 新增域时只需添加一项，无需修改任何其他代码。
 */
export const CONFIG_DOMAINS: ConfigDomain[] = [
  {
    name: "agents",
    fileName: "agents.json",
    required: false,
    dataKey: "agents",
    description: "@deprecated Agent 定义集合——使用 agentManifests 域替代。保留仅用于向后兼容。",
  },
  {
    name: "engine",
    fileName: "engine.json",
    required: false,
    schema: ENGINE_SCHEMA,
    description: "引擎运行时参数——循环上限、超时、Inspector 配置",
  },
  {
    name: "enginePlugins",
    fileName: "engine-plugins.json",
    required: false,
    dataKey: "plugins",
    schema: ENGINE_PLUGINS_SCHEMA,
    description: "引擎插件加载清单——Core-2 激活的插件（按依赖拓扑排序）",
  },
  {
    name: "tools",
    fileName: "tools.json",
    required: false,
    dataKey: "tools",
    schema: TOOLS_SCHEMA,
    description: "工具元数据定义——每把工具的声明式描述",
  },
  {
    name: "eventRouting",
    fileName: "event-routing.json",
    required: true,
    schema: EVENT_ROUTING_SCHEMA,
    description: "事件路由配置——四通道物理分层与委员会召集规则",
  },
  {
    name: "roundtable",
    fileName: "roundtable.json",
    required: false,
    dataKey: "templates",
    schema: ROUNDTABLE_SCHEMA,
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
    schema: MCP_SERVERS_SCHEMA,
    description: "MCP Server 配置——对齐行业标准 mcpServers 格式",
  },
  {
    name: "selfExamination",
    fileName: "self-examination.json",
    required: false,
    schema: SELF_EXAMINATION_SCHEMA,
    description: "自审视脚本配置——hard/soft 模式独立配置",
  },
  {
    name: "crossVerification",
    fileName: "cross-verification.json",
    required: false,
    dataKey: "pairs",
    schema: CROSS_VERIFICATION_SCHEMA,
    description: "交叉验证配对表——报告与验证者配对",
  },
  {
    name: "seedMemories",
    fileName: "seed-memories.json",
    required: false,
    dataKey: "entries",
    schema: SEED_MEMORIES_SCHEMA,
    description: "种子记忆——MemoryStore 初始化写入",
  },
  {
    name: "governancePipeline",
    fileName: "governance-pipeline.json",
    required: false,
    schema: GOVERNANCE_PIPELINE_SCHEMA,
    description: "治理管线配置——制度制度化的运行引擎",
  },
  {
    name: "cognition",
    fileName: "cognition.json",
    required: false,
    schema: COGNITION_SCHEMA,
    description: "认知配置——Agent 激活矩阵与注意力策略",
  },
  {
    name: "docs",
    fileName: "docs.json",
    required: false,
    schema: DOCS_SCHEMA,
    description: "文档配置——宪法路径与文档注册表",
  },
  {
    name: "models",
    fileName: "models.json",
    required: true,
    dataKey: "models",
    schema: MODELS_SCHEMA,
    description: "L1·模型层——Cortex 唯一两模型，agent key 决定路由",
  },
  {
    name: "keysContext",
    fileName: "keys-context.json",
    required: true,
    schema: KEYS_CONTEXT_SCHEMA,
    description: "L2·密钥+上下文层——API 鉴权、模型路由、窗口上限",
  },
  {
    name: "agentManifests",
    fileName: "agent-manifests.json",
    required: true,
    schema: AGENT_MANIFEST_SCHEMA,
    description: "L3·Agent 层——声明差异，type→profile→key→model",
  },
  {
    name: "tuning",
    fileName: "tuning.json",
    required: false,
    schema: TUNING_SCHEMA,
    description: "L4·调参层——环境变量 + 运行时调参，按域分组",
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
): T | undefined {
  const domain = CONFIG_DOMAINS.find((d) => d.name === domainName);
  if (!domain) {
    throw new ConfigLoadError(
      `未知的配置域 "${domainName}"。有效域: ${CONFIG_DOMAINS.map((d) => d.name).join(", ")}`,
      domainName,
    );
  }

  const filePath = path.join(dataDir, domain.fileName);

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
  let result: unknown;
  if (domain.dataKey) {
    if (!(domain.dataKey in data)) {
      throw new ConfigValidationError(
        `配置文件 ${filePath} 缺少 "${domain.dataKey}" 字段`,
        domainName,
      );
    }
    result = data[domain.dataKey];
  } else {
    result = data;
  }

  // 如果域注册了 JSON Schema，执行结构校验（硬阻断）
  validateDomainWithSchema(domainName, result);

  return result as T;
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
      const result = loadConfigDomain(domain.name, readFile, dataDir);
      if (result !== undefined) {
        config[domain.name] = result;
      }
    } catch (e) {
      if (domain.required) {
        throw e;
      }
      // 可选域解析失败——记录警告而非静默丢弃
      console.warn(
        `[ConfigLoader] 可选域 "${domain.name}" 加载失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return config;
}

// ─── 校验器 ──────────────────────────────────────────

/**
 * 为每个 ConfigDomain 定义字段级校验规则。
 * 在严格模式（strictConfigMode = true）下，加载后对每个域执行此校验。
 * 校验失败抛 ConfigValidationError，阻断 bootstrap。
 */
export const DOMAIN_VALIDATORS: Record<string, (data: unknown, domain: string) => string[]> = {
  agents: (data: unknown) => {
    const errs: string[] = [];
    if (!Array.isArray(data)) errs.push("agents 必须是数组");
    return errs;
  },
  engine: (_data: unknown) => [] as string[], // 所有字段可选
  mcpServers: (data: unknown) => {
    const errs: string[] = [];
    if (typeof data !== "object" || data === null) errs.push("mcpServers 必须是对象");
    return errs;
  },
};

/**
 * 对指定域的数据执行字段级校验。
 * 仅在 strictConfigMode 为 true 时调用。
 * 校验不通过抛 ConfigValidationError。
 */
export function validateConfigDomain(
  domainName: string,
  data: unknown,
): void {
  const validator = DOMAIN_VALIDATORS[domainName];
  if (!validator) return; // 没有校验规则的域跳过
  const errors = validator(data, domainName);
  if (errors.length > 0) {
    throw new ConfigValidationError(
      `配置域 "${domainName}" 校验失败:\n  - ${errors.join("\n  - ")}`,
      domainName,
    );
  }
}

// ─── 全量校验 ──────────────────────────────────────────

/**
 * 对所有已加载的配置域执行字段级校验。
 * 调用时机：loadAllConfig 之后，bootstrap 使用之前。
 */
export function validateAllConfigs(config: CortexConfig): void {
  for (const domainName of Object.keys(DOMAIN_VALIDATORS)) {
    const data = config[domainName];
    if (data === undefined) continue; // 可选域未加载不校验
    validateConfigDomain(domainName, data);
  }
}

// ─── JSON Schema 校验 ─────────────────────────────────

/** 单个 schema 校验错误 */
export interface SchemaValidationError {
  path: string;
  message: string;
}

/**
 * 按 JSON Schema 校验数据——Draft-07 子集实现。
 * 零外部依赖，仅支持 Cortex config 所需的核心关键字。
 */
export function validateJsonSchema(
  data: unknown,
  schema: JsonSchema,
  path: string = "$",
): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];

  // null 同构 null / 缺失 undefined 跳过
  if (data === undefined || data === null) {
    if (schema.type && schema.type !== "null") {
      errors.push({ path, message: schema._message ?? `期望 ${schema.type}，实际 null` });
    }
    return errors;
  }

  // type 校验
  if (schema.type === "object") {
    if (typeof data !== "object" || Array.isArray(data)) {
      errors.push({ path, message: schema._message ?? `期望 object，实际 ${typeof data}` });
      return errors;
    }
    const obj = data as Record<string, unknown>;
    // required
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push({ path: `${path}.${key}`, message: `缺少必填字段: ${key}` });
        }
      }
    }
    // properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          errors.push(...validateJsonSchema(obj[key], propSchema, `${path}.${key}`));
        }
      }
    }
    // additionalProperties — 处理未被 properties 覆盖的键
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      const knownKeys = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(obj)) {
        if (!knownKeys.has(key)) {
          errors.push(...validateJsonSchema(obj[key], schema.additionalProperties, `${path}.${key}`));
        }
      }
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(data)) {
      errors.push({ path, message: schema._message ?? `期望 array，实际 ${typeof data}` });
      return errors;
    }
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        errors.push(...validateJsonSchema(data[i], schema.items, `${path}[${i}]`));
      }
    }
  } else if (schema.type === "string") {
    if (typeof data !== "string") {
      errors.push({ path, message: schema._message ?? `期望 string，实际 ${typeof data}` });
    } else {
      if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
        errors.push({ path, message: `不匹配模式: ${schema.pattern}` });
      }
      if (schema.minLength !== undefined && data.length < schema.minLength) {
        errors.push({ path, message: `最小长度 ${schema.minLength}，实际 ${data.length}` });
      }
      if (schema.enum && !schema.enum.includes(data)) {
        errors.push({ path, message: `不在枚举值中: ${schema.enum.join(", ")}` });
      }
    }
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof data !== "number") {
      errors.push({ path, message: schema._message ?? `期望 ${schema.type}，实际 ${typeof data}` });
    } else {
      if (schema.type === "integer" && !Number.isInteger(data)) {
        errors.push({ path, message: `期望 integer，实际 ${data}` });
      }
      if (schema.minimum !== undefined && data < schema.minimum) {
        errors.push({ path, message: `最小值 ${schema.minimum}，实际 ${data}` });
      }
      if (schema.maximum !== undefined && data > schema.maximum) {
        errors.push({ path, message: `最大值 ${schema.maximum}，实际 ${data}` });
      }
    }
  } else if (schema.type === "boolean") {
    if (typeof data !== "boolean") {
      errors.push({ path, message: schema._message ?? `期望 boolean，实际 ${typeof data}` });
    }
  }

  return errors;
}

/**
 * 对已加载的域数据执行 JSON Schema 校验。
 * 校验失败抛 ConfigValidationError。
 */
export function validateDomainWithSchema(
  domainName: string,
  data: unknown,
): void {
  const domain = CONFIG_DOMAINS.find((d) => d.name === domainName);
  if (!domain?.schema) return;
  const errors = validateJsonSchema(data, domain.schema);
  if (errors.length > 0) {
    const detail = errors.slice(0, 10).map((e) => `  ${e.path}: ${e.message}`).join("\n");
    throw new ConfigValidationError(
      `Schema 校验失败 (${errors.length} 处):\n${detail}${errors.length > 10 ? `\n  ... 还有 ${errors.length - 10} 处` : ""}`,
      domainName,
    );
  }
}

/** 安全校验——返回 { ok, errors } 而非抛异常 */
export function validateSafe(
  domainName: string,
  data: unknown,
): { ok: boolean; errors: SchemaValidationError[] } {
  const domain = CONFIG_DOMAINS.find((d) => d.name === domainName);
  if (!domain?.schema) return { ok: true, errors: [] };
  const errors = validateJsonSchema(data, domain.schema);
  return { ok: errors.length === 0, errors };
}

/** 按给定 JSON Schema 校验任意数据并抛异常 */
export function validateOrThrow(
  data: unknown,
  schema: JsonSchema,
  label?: string,
): void {
  const errors = validateJsonSchema(data, schema);
  if (errors.length > 0) {
    const name = label ?? "data";
    const detail = errors.slice(0, 10).map((e) => `  ${e.path}: ${e.message}`).join("\n");
    throw new ConfigValidationError(
      `${name} Schema 校验失败 (${errors.length} 处):\n${detail}${errors.length > 10 ? `\n  ... 还有 ${errors.length - 10} 处` : ""}`,
      name,
    );
  }
}

// ─── 全量配置类型 ──────────────────────────────────────

/** 全量 Cortex 配置——按域索引 */
export interface CortexConfig {
  /** @deprecated 使用 agentManifests 替代 */
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
  models?: Record<string, ModelEntry>;
  keysContext?: KeysContextConfig;
  agentManifests?: AgentManifestConfig;
  tuning?: TuningConfig;
  /** 动态域索引——由 loadConfigDomain 按 CONFIG_DOMAINS 动态填入。外部消费者不应使用此签名。 */
  [key: string]: unknown;
}
