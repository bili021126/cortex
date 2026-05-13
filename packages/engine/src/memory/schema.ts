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
export const SCHEMA_VERSION = 1;

/** 防抖写盘间隔（毫秒）。200ms 内的多次变更合并为一次写盘 */
export const FLUSH_DEBOUNCE_MS = 200;

/** 防饿死上限：连续失败超过此值延迟重试间隔指数增长 */
export const MAX_FLUSH_FAIL_STREAK = 3;

// ── 向量 ──────────────────────────────────────

/** embedding 维度（all-MiniLM-L6-v2 输出 D=384） */
export const EMBEDDING_DIM = 384;

// ── LinkType → 初始权重映射（议题四 3.3） ──────

export const LINK_WEIGHTS: Record<string, number> = {
  ACCESSED_DURING: 0.2,
  PRODUCED_BY: 0.5,
  DERIVED_FROM: 0.7,
  DEPENDS_ON: 0.9,
  REFACTORED_FROM: 0.8,
  CITED_IN_COMMITTEE: 0.7,
  CASCADE_TO: 1.0,
};
