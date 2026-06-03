/**
 * MemoryStore 共享常量 — 零依赖，被所有 memory/ 子模块引用。
 *
 * @module memory/schema
 */

// ── TTL ────────────────────────────────────────

/** 30 天：过期窗口（标记但不真删，read() 自动过滤） */
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ── 持久化 ─────────────────────────────────────

/** 当前持久化模式版本——变更时需编写迁移逻辑 */
export const SCHEMA_VERSION = 5;

/** 防抖写盘间隔（毫秒）。200ms 内的多次变更合并为一次写盘 */
export const FLUSH_DEBOUNCE_MS = 200;

/** 防饿死上限：连续失败超过此值延迟重试间隔指数增长 */
export const MAX_FLUSH_FAIL_STREAK = 3;

// ── 向量 ──────────────────────────────────────

/** embedding 维度（all-MiniLM-L6-v2 输出 D=384） */
export const EMBEDDING_DIM = 384;

// ── LinkType → 初始权重映射（议题四 3.3） ──────

export const LINK_WEIGHTS: Record<string, number> = {
  PRODUCED_BY: 0.5,
  DERIVED_FROM: 0.7,
  CONFIRMED_USEFUL: 0.8,
  CONFIRMED_NOISE: 0.1,
};

// ── 内容去重 ──────────────────────────────────

/** SHA256 哈希算法标识 */
export const CONTENT_HASH_ALGO = "sha256";

/** 向量相似度 ≥ 此值视为语义重复（余弦相似度，归一化向量下等价于点积） */
export const VECTOR_DEDUP_THRESHOLD = 0.95;

// ── BFS 噪声门限 ──────────────────────────────

/** BFS 展开时，decay 后权重低于此值的节点不加入结果 */
export const BFS_WEIGHT_THRESHOLD = 0.1;

/** BFS 每节点最多考察的出边数（按 link.weight 降序取前 N） */
export const MAX_LINKS_PER_NODE = 10;

// ── 权重老化 ──────────────────────────────────

/** 权重老化因子：每 7 天未访问衰减 5%（0.95^(daysSinceAccess/7)） */
export const WEIGHT_AGING_FACTOR = 0.95;

// ── 总量控制 ──────────────────────────────────

/** 内存记忆条目软上限，超出时按 lastAccessedAt 升序 archive 最久未访问的记忆 */
export const MAX_TOTAL_MEMORIES = 10000;

// ── 主动维护 ──────────────────────────────────

/** maintain() 冻结窗口：Active 记忆超过此天数未访问且权重低于门限则冻结 */
export const STALE_FREEZE_DAYS = 30;

/** maintain() 湮灭窗口：Frozen 记忆超过此天数则湮灭 */
export const FROZEN_OBLITERATE_DAYS = 7;

/** maintain() 权重门限：只有权重低于此值的 Active 记忆才会被主动冻结（高权重长期记忆保留） */
export const MAINTENANCE_WEIGHT_THRESHOLD = 0.05;
