/**
 * engine-defaults.ts — Engine 层独有常量
 *
 * 集中 engine 层所有硬编码常量，消除魔法数字。
 * 同时被 memory-store/schema.ts 和 engine 模块消费。
 *
 * @since v3.x — 全系统重构
 * @since v2.7 — 横向解耦：从 @cortex/engine 迁入 @cortex/config
 */

import { DEFAULT_MAX_TOTAL_MEMORIES } from "./constants/index.js";

// ─── FileLock ──────────────────────────────────────

/** 文件锁默认超时（毫秒） */
export const DEFAULT_LOCK_TIMEOUT_MS = 30_000;

/** 文件锁清理间隔（毫秒） */
export const CLEANUP_INTERVAL_MS = 60_000;

// ─── Shutdown ──────────────────────────────────────

/** 优雅关闭超时（毫秒） */
export const SHUTDOWN_TIMEOUT_MS = 15_000;

/** 强制退出延迟（毫秒） */
export const SHUTDOWN_FORCE_EXIT_DELAY_MS = 2_000;

// ─── Scheduler ─────────────────────────────────────

/** 调度器最大轮数 */
export const SCHEDULER_MAX_ROUNDS = 25;

/** 调度器每轮超时（毫秒） */
export const SCHEDULER_ROUND_TIMEOUT_MS = 120_000;

/** ReAct 最大循环次数 */
export const REACT_MAX_LOOPS = 20;

// ─── Embedding ─────────────────────────────────────

/** 向量维度（384d ONNX） */
export const EMBEDDING_DIM = 384;

/** 向量 LRU 缓存容量 */
export const EMBEDDING_CACHE_SIZE = 10_000;

/** 内容哈希算法 */
export const CONTENT_HASH_ALGO = "sha256";

/** 向量去重余弦相似度阈值 */
export const VECTOR_DEDUP_THRESHOLD = 0.95;

/** 权重衰减因子 */
export const WEIGHT_AGING_FACTOR = 0.95;

/** 过期未访问天数阈值（可归档） */
export const STALE_FREEZE_DAYS = 30;

/** 归档后湮灭天数 */
export const FROZEN_OBLITERATE_DAYS = 7;

/** maintenance 权重阈值 */
export const MAINTENANCE_WEIGHT_THRESHOLD = 0.05;

/** 记忆总数上限（委托 @cortex/config） */
export const MAX_TOTAL_MEMORIES = DEFAULT_MAX_TOTAL_MEMORIES;

/** 记忆模式版本号 */
export const SCHEMA_VERSION = 5;

// ─── Monitor ───────────────────────────────────────

/** 监控时间窗口（毫秒） */
export const MONITOR_WINDOW_MS = 60_000;

/** 监控告警阈值 */
export const MONITOR_THRESHOLD = 10;

// ─── EngineDefaults 类型 ──────────────────────────

export interface EngineDefaults {
  lockTimeoutMs: number;
  cleanupIntervalMs: number;
  shutdownTimeoutMs: number;
  shutdownForceExitDelayMs: number;
  schedulerMaxRounds: number;
  schedulerRoundTimeoutMs: number;
  reactMaxLoops: number;
  embeddingDim: number;
  embeddingCacheSize: number;
  contentHashAlgo: string;
  vectorDedupThreshold: number;
  weightAgingFactor: number;
  staleFreezeDays: number;
  frozenObliterateDays: number;
  maintenanceWeightThreshold: number;
  maxTotalMemories: number;
  schemaVersion: number;
  monitorWindowMs: number;
  monitorThreshold: number;
  retrievalAlpha: number;
  retrievalBeta: number;
}

/** Engine 默认配置单例 */
export const ENGINE_DEFAULTS: EngineDefaults = {
  lockTimeoutMs: DEFAULT_LOCK_TIMEOUT_MS,
  cleanupIntervalMs: CLEANUP_INTERVAL_MS,
  shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
  shutdownForceExitDelayMs: SHUTDOWN_FORCE_EXIT_DELAY_MS,
  schedulerMaxRounds: SCHEDULER_MAX_ROUNDS,
  schedulerRoundTimeoutMs: SCHEDULER_ROUND_TIMEOUT_MS,
  reactMaxLoops: REACT_MAX_LOOPS,
  embeddingDim: EMBEDDING_DIM,
  embeddingCacheSize: EMBEDDING_CACHE_SIZE,
  contentHashAlgo: CONTENT_HASH_ALGO,
  vectorDedupThreshold: VECTOR_DEDUP_THRESHOLD,
  weightAgingFactor: WEIGHT_AGING_FACTOR,
  staleFreezeDays: STALE_FREEZE_DAYS,
  frozenObliterateDays: FROZEN_OBLITERATE_DAYS,
  maintenanceWeightThreshold: MAINTENANCE_WEIGHT_THRESHOLD,
  maxTotalMemories: MAX_TOTAL_MEMORIES,
  schemaVersion: SCHEMA_VERSION,
  monitorWindowMs: MONITOR_WINDOW_MS,
  monitorThreshold: MONITOR_THRESHOLD,
  retrievalAlpha: 0.45,
  retrievalBeta: 0.55,
};

// ─── loadEngineDefaults ───────────────────────────

/**
 * 加载引擎默认配置，支持 overrides 和环境变量覆盖。
 *
 * 优先级：overrides 参数 > CORTEX_* 环境变量 > 默认值
 */
export function loadEngineDefaults(overrides?: Partial<EngineDefaults>): EngineDefaults {
  const env = _readEnvOverrides();
  return { ...ENGINE_DEFAULTS, ...env, ...overrides };
}

/** CORTEX_ 环境变量 → EngineDefaults 字段映射 */
const ENV_MAP: Record<string, keyof EngineDefaults> = {
  CORTEX_LOCK_TIMEOUT_MS: "lockTimeoutMs",
  CORTEX_CLEANUP_INTERVAL_MS: "cleanupIntervalMs",
  CORTEX_SHUTDOWN_TIMEOUT_MS: "shutdownTimeoutMs",
  CORTEX_SHUTDOWN_FORCE_EXIT_DELAY_MS: "shutdownForceExitDelayMs",
  CORTEX_SCHEDULER_MAX_ROUNDS: "schedulerMaxRounds",
  CORTEX_SCHEDULER_ROUND_TIMEOUT_MS: "schedulerRoundTimeoutMs",
  CORTEX_REACT_MAX_LOOPS: "reactMaxLoops",
  CORTEX_EMBEDDING_DIM: "embeddingDim",
  CORTEX_EMBEDDING_CACHE_SIZE: "embeddingCacheSize",
  CORTEX_CONTENT_HASH_ALGO: "contentHashAlgo",
  CORTEX_VECTOR_DEDUP_THRESHOLD: "vectorDedupThreshold",
  CORTEX_WEIGHT_AGING_FACTOR: "weightAgingFactor",
  CORTEX_STALE_FREEZE_DAYS: "staleFreezeDays",
  CORTEX_FROZEN_OBLITERATE_DAYS: "frozenObliterateDays",
  CORTEX_MAINTENANCE_WEIGHT_THRESHOLD: "maintenanceWeightThreshold",
  CORTEX_MAX_TOTAL_MEMORIES: "maxTotalMemories",
  CORTEX_SCHEMA_VERSION: "schemaVersion",
  CORTEX_MONITOR_WINDOW_MS: "monitorWindowMs",
  CORTEX_MONITOR_THRESHOLD: "monitorThreshold",
};

function _readEnvOverrides(): Partial<EngineDefaults> {
  const overrides: Partial<EngineDefaults> = {};
  for (const [envKey, configKey] of Object.entries(ENV_MAP)) {
    const val = process.env[envKey];
    if (val !== undefined) {
      const num = Number(val);
      (overrides as Record<string, unknown>)[configKey] = Number.isNaN(num) ? val : num;
    }
  }
  return overrides;
}
