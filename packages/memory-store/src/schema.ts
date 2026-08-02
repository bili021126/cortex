// ============================================================
// @cortex/memory-store/schema —— 认知记忆层共享常量
//
// Phase 4 收敛：常量定义迁至 @cortex/config/constants/memory.ts，
// 本文件改为从 @cortex/config 导入再 re-export，保持下游兼容。
//
// ENG-2：运行时调参接线——值改为 loadEngineDefaults() 覆盖链
// （tuning.json/env > 静态常量兜底），默认值不变，调参后自动生效。
// ============================================================

import {
  EMBEDDING_DIM as STATIC_EMBEDDING_DIM,
  CONTENT_HASH_ALGO as STATIC_CONTENT_HASH_ALGO,
  VECTOR_DEDUP_THRESHOLD as STATIC_VECTOR_DEDUP_THRESHOLD,
  WEIGHT_AGING_FACTOR as STATIC_WEIGHT_AGING_FACTOR,
  STALE_FREEZE_DAYS as STATIC_STALE_FREEZE_DAYS,
  FROZEN_OBLITERATE_DAYS as STATIC_FROZEN_OBLITERATE_DAYS,
  MAINTENANCE_WEIGHT_THRESHOLD as STATIC_MAINTENANCE_WEIGHT_THRESHOLD,
  SCHEMA_VERSION as STATIC_SCHEMA_VERSION,
  DEFAULT_MAX_TOTAL_MEMORIES,
  loadEngineDefaults,
} from "@cortex/config";

// ENG-2：动态调参——每次模块加载时取覆盖链结果（tuning 有缓存，env 读取廉价）
const _tuned = loadEngineDefaults();

export const EMBEDDING_DIM = _tuned.embeddingDim ?? STATIC_EMBEDDING_DIM;
export const CONTENT_HASH_ALGO = _tuned.contentHashAlgo ?? STATIC_CONTENT_HASH_ALGO;
export const VECTOR_DEDUP_THRESHOLD = _tuned.vectorDedupThreshold ?? STATIC_VECTOR_DEDUP_THRESHOLD;
export const WEIGHT_AGING_FACTOR = _tuned.weightAgingFactor ?? STATIC_WEIGHT_AGING_FACTOR;
export const STALE_FREEZE_DAYS = _tuned.staleFreezeDays ?? STATIC_STALE_FREEZE_DAYS;
export const FROZEN_OBLITERATE_DAYS = _tuned.frozenObliterateDays ?? STATIC_FROZEN_OBLITERATE_DAYS;
export const MAINTENANCE_WEIGHT_THRESHOLD = _tuned.maintenanceWeightThreshold ?? STATIC_MAINTENANCE_WEIGHT_THRESHOLD;
export const SCHEMA_VERSION = _tuned.schemaVersion ?? STATIC_SCHEMA_VERSION;

/** 记忆总数上限（委托 @cortex/config 统一常量，ENG-2 接入调参） */
export const MAX_TOTAL_MEMORIES = _tuned.maxTotalMemories ?? DEFAULT_MAX_TOTAL_MEMORIES;
