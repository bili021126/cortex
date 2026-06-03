/**
 * @cortex/config — 配置接口定义
 *
 * 所有配置相关的 TypeScript 接口集中于此。
 * 零运行时依赖，纯类型层。
 *
 * @module interfaces
 * @layer root — 所有包共同依赖的配置类型层
 */

// ════════════════════════════════════════════════════════
// 引擎运行时配置
// ════════════════════════════════════════════════════════

/** 引擎运行时配置——所有字段可选，未提供时走默认值 */
export interface EngineConfig {
  /** Agent ReAct 循环上限。默认 64 */
  defaultMaxLoops?: number;
  /** InspectorAgent ReAct 循环上限（降低以抑制幻觉风险）。默认 48 */
  inspectorMaxLoops?: number;
  /** 单节点最大重规划轮次。默认 3 */
  maxReplanPerNode?: number;
  /** 单次 executeAll 全局最大重规划次数。默认 3 */
  maxTotalReplans?: number;
  /** executeAll 全局超时 (ms)。默认 600_000 (10分钟) */
  executeAllTimeoutMs?: number;
  /** 单 Agent ReAct 循环墙钟超时 (ms)。默认 300_000 (5分钟) */
  reactLoopTimeoutMs?: number;

  /** 工具执行超时 (ms) */
  toolTimeouts?: ToolTimeoutsConfig;

  /** InspectorAgent 编译/测试采集超时 (ms) */
  inspector?: InspectorConfig;

  /** 搜索后端配置 */
  search?: SearchConfig;

  /** LLM 配置 */
  llm?: LlmConfig;

  /** 文件路径默认值（相对于项目根目录） */
  filePaths?: FilePathsConfig;

  /** 可执行技能系统默认值 */
  skillSystem?: SkillSystemConfig;
}

/** 工具超时配置 */
export interface ToolTimeoutsConfig {
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
}

/** Inspector 超时配置 */
export interface InspectorConfig {
  /** tsc --noEmit 超时。默认 30_000 */
  tscTimeout?: number;
  /** tsx 测试执行超时。默认 30_000 */
  testTimeout?: number;
  /** vitest 超时。默认 60_000 */
  vitestTimeout?: number;
}

/** LLM 配置 */
export interface LlmConfig {
  /** API Base URL。默认 https://api.deepseek.com/v1 */
  baseUrl?: string;
  /** Chat 模型名。默认 deepseek-chat */
  chatModel?: string;
  /** Reasoner 模型名。默认 deepseek-reasoner */
  reasonerModel?: string;
}

/** 文件路径配置（相对项目根目录） */
export interface FilePathsConfig {
  /** 技能注册表 JSON 文件名（.cortex 目录下） */
  skillRegistry?: string;
  /** 编码规范文件路径 */
  codingStandards?: string;
  /** 哈希缓存文件名（.cortex 目录下） */
  hashCache?: string;
}

/** 可执行技能系统配置 */
export interface SkillSystemConfig {
  /** 技能默认超时 (ms)。默认 30_000 */
  defaultTimeoutMs?: number;
  /** 技能默认最大重试次数。默认 0 */
  maxRetries?: number;
}

// ════════════════════════════════════════════════════════
// 搜索后端配置
// ════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════
// 输出格式
// ════════════════════════════════════════════════════════

export const OUTPUT_FORMATS = ["text", "json", "color"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
