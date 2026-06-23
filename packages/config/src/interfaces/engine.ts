/**
 * @cortex/config — 引擎运行时配置接口
 *
 * @module interfaces/engine
 * @layer root — 零依赖，纯类型层
 */

import type { SearchConfig } from "./search.js";

/** 引擎运行时配置——所有字段可选，未提供时走默认值 */
export interface EngineConfig {
  /** Agent ReAct 循环上限。默认 64 */
  defaultMaxLoops?: number;
  /** InspectorAgent ReAct 循环上限（降低以抑制幻觉风险）。默认 48 */
  inspectorMaxLoops?: number;
  /** 单节点最大重规划轮次。默认 10 */
  maxReplanPerNode?: number;
  /** 单次 executeAll 全局最大重规划次数。默认 50 */
  maxTotalReplans?: number;
  /** executeAll 全局超时 (ms)。默认 600_000 (10分钟) */
  executeAllTimeoutMs?: number;
  /** mHC 流约束获取槽位超时 (ms)。默认 60_000 (1分钟)——超时后节点优雅失败 */
  manifoldGateAcquireTimeoutMs?: number;
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
  searchCode?: number;
  runShell?: number;
  confirmWait?: number;
  webSearch?: number;
  webSearchRetries?: number;
  webSearchCacheTTL?: number;
}

/** Inspector 超时配置 */
export interface InspectorConfig {
  tscTimeout?: number;
  testTimeout?: number;
  vitestTimeout?: number;

  /** 混合检索 BM25 权重 (0..1)。默认 0.45。对应 HybridRetrievalConfig.alpha */
  retrievalAlpha?: number;
  /** 混合检索向量相似度权重 (0..1)。默认 0.55。对应 HybridRetrievalConfig.beta */
  retrievalBeta?: number;
}

/** LLM 配置 */
export interface LlmConfig {
  baseUrl?: string;
  chatModel?: string;
  reasonerModel?: string;
}

/** 文件路径配置（相对项目根目录） */
export interface FilePathsConfig {
  skillRegistry?: string;
  codingStandards?: string;
  hashCache?: string;
  soloFlightOutput?: string;
}

/** 可执行技能系统配置 */
export interface SkillSystemConfig {
  defaultTimeoutMs?: number;
  maxRetries?: number;
}
