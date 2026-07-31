/**
 * engine-defaults.ts — Engine 层独有常量
 *
 * 集中 engine 层所有硬编码常量，消除魔法数字。
 * 同时被 memory-store/schema.ts 和 engine 模块消费。
 *
 * @since v3.x — 全系统重构
 * @since v2.7 — 横向解耦：从 @cortex/engine 迁入 @cortex/config
 */

import * as fs from "node:fs";

import {
  DEFAULT_MAX_TOTAL_MEMORIES,
  EMBEDDING_DIM,
  VECTOR_DEDUP_THRESHOLD,
  WEIGHT_AGING_FACTOR,
  STALE_FREEZE_DAYS,
  FROZEN_OBLITERATE_DAYS,
  MAINTENANCE_WEIGHT_THRESHOLD,
  SCHEMA_VERSION,
  SCHEDULER_ROUND_TIMEOUT_MS,
  REACT_MAX_LOOPS,
} from "./constants/index.js";

import { loadConfigDomain, resolveConfigDataDir, type ConfigFileReader } from "./loader.js";
import type { TuningConfig } from "./interfaces/tuning.js";

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

/** 调度器每轮超时（毫秒）——P2 收敛：单源在 constants/scheduler-params.ts */
export { SCHEDULER_ROUND_TIMEOUT_MS };

/** ReAct 最大循环次数——P1-1 单源在 constants/react-strategy.ts，此处仅转发 */
export { REACT_MAX_LOOPS };

/** ManifoldGate 获取锁超时（毫秒） */
export const DEFAULT_ACQUIRE_TIMEOUT_MS = 60_000;

// ─── Retrieval ─────────────────────────────────────

/** BM25 权重（混合检索 alpha） */
export const RETRIEVAL_ALPHA = 0.45;

/** 向量相似度权重（混合检索 beta） */
export const RETRIEVAL_BETA = 0.55;

// ─── Embedding ─────────────────────────────────────

/** 向量维度（384d ONNX），单源定义 @cortex/config/constants/memory */
export { EMBEDDING_DIM };

/** 向量 LRU 缓存容量 */
export const EMBEDDING_CACHE_SIZE = 10_000;

/** 内容哈希算法 */
export const CONTENT_HASH_ALGO = "sha256";

/** 向量去重余弦相似度阈值，单源定义 @cortex/config/constants/memory */
export { VECTOR_DEDUP_THRESHOLD };

/** 权重衰减因子，单源定义 @cortex/config/constants/memory */
export { WEIGHT_AGING_FACTOR };

/** 过期未访问天数阈值（可归档），单源定义 @cortex/config/constants/memory */
export { STALE_FREEZE_DAYS };

/** 归档后湮灭天数，单源定义 @cortex/config/constants/memory */
export { FROZEN_OBLITERATE_DAYS };

/** maintenance 权重阈值，单源定义 @cortex/config/constants/memory */
export { MAINTENANCE_WEIGHT_THRESHOLD };

/** 记忆总数上限（委托 @cortex/config） */
export const MAX_TOTAL_MEMORIES = DEFAULT_MAX_TOTAL_MEMORIES;

/** 记忆模式版本号，单源定义 @cortex/config/constants/memory */
export { SCHEMA_VERSION };

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
  manifoldGateAcquireTimeoutMs: number;
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
  retrievalAlpha: RETRIEVAL_ALPHA,
  retrievalBeta: RETRIEVAL_BETA,
  manifoldGateAcquireTimeoutMs: DEFAULT_ACQUIRE_TIMEOUT_MS,
};

// ─── loadEngineDefaults ───────────────────────────

/**
 * 加载引擎默认配置，支持 overrides 和环境变量覆盖。
 *
 * 优先级：overrides 参数 > CORTEX_* 环境变量 > tuning.json 调参域 > 硬编码兜底常量
 */
export function loadEngineDefaults(overrides?: Partial<EngineDefaults>): EngineDefaults {
  const fromTuning = _loadTuningDefaults();
  const env = _readEnvOverrides();
  return { ...ENGINE_DEFAULTS, ...fromTuning, ...env, ...overrides };
}

// ─── 从 tuning.json 读取 ───────────────────────────

/** 缓存——避免重复文件 I/O */
let _cachedTuningDefaults: Partial<EngineDefaults> | null = null;

/**
 * 从 tuning.json 读取调参域，映射为 Partial<EngineDefaults>。
 * fail-open：文件缺失或解析失败时返回 {}。
 */
function _loadTuningDefaults(): Partial<EngineDefaults> {
  if (_cachedTuningDefaults !== null) return _cachedTuningDefaults;

  try {
    const dataDir = resolveConfigDataDir();
    const readFile: ConfigFileReader = (fp: string) => fs.readFileSync(fp, "utf-8");
    const tuning = loadConfigDomain<TuningConfig>("tuning", readFile, dataDir);

    if (!tuning?.tuning) {
      _cachedTuningDefaults = {};
      return {};
    }

    const t = tuning.tuning;
    const result: Partial<EngineDefaults> = {};

    // map tuning.execution.*
    if (t.execution?.reactMaxLoops !== undefined) {
      result.reactMaxLoops = t.execution.reactMaxLoops;
    }

    // map tuning.memory.*
    if (t.memory?.vectorDedupThreshold !== undefined) {
      result.vectorDedupThreshold = t.memory.vectorDedupThreshold;
    }
    if (t.memory?.staleFreezeDays !== undefined) {
      result.staleFreezeDays = t.memory.staleFreezeDays;
    }
    if (t.memory?.frozenObliterateDays !== undefined) {
      result.frozenObliterateDays = t.memory.frozenObliterateDays;
    }
    if (t.memory?.maintenanceWeightThreshold !== undefined) {
      result.maintenanceWeightThreshold = t.memory.maintenanceWeightThreshold;
    }

    _cachedTuningDefaults = result;
    return result;
  } catch {
    // fail-open：加载失败时回退到硬编码空白（不崩溃）
    _cachedTuningDefaults = {};
    return {};
  }
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
      const defaultValue = ENGINE_DEFAULTS[configKey];
      // 按默认值类型处理: string 字段保留原值，number 字段做转换
      const num = Number(val);
      (overrides as Record<string, unknown>)[configKey] =
        typeof defaultValue === "string" ? val : (isNaN(num) ? defaultValue : num);
    }
  }
  return overrides;
}
