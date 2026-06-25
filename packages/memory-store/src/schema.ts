// ============================================================
// @cortex/memory-store/schema —— 认知记忆层共享常量
//
// Phase 4 收敛：常量定义迁至 @cortex/config/constants/memory.ts，
// 本文件改为从 @cortex/config 导入再 re-export，保持下游兼容。
// ============================================================

import {
  EMBEDDING_DIM,
  CONTENT_HASH_ALGO,
  VECTOR_DEDUP_THRESHOLD,
  WEIGHT_AGING_FACTOR,
  STALE_FREEZE_DAYS,
  FROZEN_OBLITERATE_DAYS,
  MAINTENANCE_WEIGHT_THRESHOLD,
  SCHEMA_VERSION,
  DEFAULT_MAX_TOTAL_MEMORIES,
} from "@cortex/config";

export {
  EMBEDDING_DIM,
  CONTENT_HASH_ALGO,
  VECTOR_DEDUP_THRESHOLD,
  WEIGHT_AGING_FACTOR,
  STALE_FREEZE_DAYS,
  FROZEN_OBLITERATE_DAYS,
  MAINTENANCE_WEIGHT_THRESHOLD,
  SCHEMA_VERSION,
};

/** 记忆总数上限（委托 @cortex/config 统一常量） */
export const MAX_TOTAL_MEMORIES = DEFAULT_MAX_TOTAL_MEMORIES;
