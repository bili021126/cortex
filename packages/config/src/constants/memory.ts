// ============================================================
// @cortex/config/constants/memory —— 认知记忆层共享常量
//
// Phase 4 收敛：EMBEDDING_DIM / VECTOR_DEDUP_THRESHOLD 等
// 7 个常量从 engine-defaults.ts + schema.ts 收归此处，
// 两侧统一导入本文件。
// ============================================================

/** ONNX 384 维语义向量 */
export const EMBEDDING_DIM = 384;

/** 向量去重余弦相似度阈值——超过视为重复 */
export const VECTOR_DEDUP_THRESHOLD = 0.95;

/** 权重衰减因子——每周期衰减至此比例 */
export const WEIGHT_AGING_FACTOR = 0.95;

/** 过期未访问多少天后标记为 stale（可归档） */
export const STALE_FREEZE_DAYS = 30;

/** 归档后多少天后可湮灭 */
export const FROZEN_OBLITERATE_DAYS = 7;

/** maintenance 时低于此权重的记忆标记为 stale */
export const MAINTENANCE_WEIGHT_THRESHOLD = 0.05;

/** 记忆模式版本号 */
export const SCHEMA_VERSION = 5;

/** BM25 默认 k1 参数——词频饱和度 */
export const BM25_DEFAULT_K1 = 1.2;

/** BM25 默认 b 参数——文档长度归一化 */
export const BM25_DEFAULT_B = 0.75;
