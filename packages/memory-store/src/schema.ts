// ============================================================
// @cortex/memory-store/schema —— 认知记忆层共享常量
//
// v2.6.6: 常量内联（原从 engine-defaults.ts 导入），独立包不再依赖 engine。
// ============================================================

import { DEFAULT_MAX_TOTAL_MEMORIES } from "@cortex/config";

// ── Embedding ────────────────────────────────

/** ONNX 384 维语义向量 */
export const EMBEDDING_DIM = 384;

/** 内容哈希算法 */
export const CONTENT_HASH_ALGO = "sha256";

/** 向量去重余弦相似度阈值——超过视为重复 */
export const VECTOR_DEDUP_THRESHOLD = 0.95;

// ── 权重老化 ─────────────────────────────────

/** 权重衰减因子——每周期衰减至此比例 */
export const WEIGHT_AGING_FACTOR = 0.95;

/** 过期未访问多少天后标记为 stale（可归档） */
export const STALE_FREEZE_DAYS = 30;

/** 归档后多少天后可湮灭 */
export const FROZEN_OBLITERATE_DAYS = 7;

/** maintenance 时低于此权重的记忆标记为 stale */
export const MAINTENANCE_WEIGHT_THRESHOLD = 0.05;

/** 记忆总数上限（委托 @cortex/config 统一常量） */
export const MAX_TOTAL_MEMORIES = DEFAULT_MAX_TOTAL_MEMORIES;

/** 记忆模式版本号 */
export const SCHEMA_VERSION = 5;
