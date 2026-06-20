// ============================================================
// @cortex/cache —— 缓存分层桶导出
//
// @file-overview
// 独立缓存包，提供三层缓存能力：
//
// 1. LlmCache —— LLM 响应缓存（分钟级）
//    - SHA256 键控：model + messages + tools
//    - fingerprint 模式：注入文件哈希，代码变更自动失效
//    - LRU 驱逐 + TTL 过期
//
// 2. FileHashCache —— 文件哈希缓存
//    - 扫描项目源文件，建立 SHA256 索引
//    - 增量更新（mtime 比对）比全量快 10-100x
//    - diff() 返回变更文件列表
//
// 3. MemoryCacheLayer —— 记忆加速层（天/周级）
//    - 写入强一致：必须通过 ground truth 验证
//    - 读取最终一致：消费方对 stale 结果自行验证
//    - 可丢弃：不影响正确性
//
// @design 分层策略
// ┌──────────────────┐
// │   MemoryCacheLayer│ ← 天/周级，可丢弃加速层
// ├──────────────────┤
// │      LlmCache     │ ← 分钟级，文件哈希失效
// ├──────────────────┤
// │   FileHashCache   │ ← 基础设施，提供哈希快照
// └──────────────────┘
//
// @contract 写入契约
// - 强一致写入：只有 ground truth 数据才能进入缓存
// - 最终一致读取：缓存不保证最新，消费方必须二次验证
// - 失效策略：文件变更 → 文件哈希变更 → LLM 缓存自动失效
// - 记忆缓存：TTL 过期仍返回（stale=true），交由消费方裁决
//
// @governance 甘雨 P1：shared exports 统一为 import-only
// ============================================================

export { LlmCache } from "./llm-cache.js";
export { FileHashCache } from "./file-hash-cache.js";
export { MemoryCacheLayer } from "./memory-cache-layer.js";

export type { FileHashDiff } from "./file-hash-cache.js";

export type {
  CacheEntry,
  CacheStats,
  CacheWriteContract,
  LlmCacheKeyParams,
  LlmCacheValue,
  LlmCacheConfig,
  FileHashEntry,
  FileHashCacheConfig,
  MemoryCacheEntry,
  MemoryCacheConfig,
} from "./types.js";
