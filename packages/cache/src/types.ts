// ============================================================
// @cortex/cache —— 缓存类型定义
//
// @file-overview
// 定义 LLM 缓存与记忆缓存分层所需的全部类型。
// 零运行时依赖，仅使用 node: 内置模块。
//
// @design
// 1. LLM 缓存（分钟级）：key = SHA256(model + messages + tools)
//    文件哈希模式额外注入依赖文件指纹，代码变更自动失效
// 2. 记忆缓存（天/周级）：可丢弃加速层，仅做线索提示
//    写入强一致（只有 ground truth 能写入），读取最终一致
//
// @governance 甘雨 P1：导出类型需标注 immutable/mutable 意图
// ============================================================

// ── 基础缓存条目 ──

/** 通用缓存条目，支持 TTL 驱逐 */
export interface CacheEntry<T> {
  /** 缓存值 */
  value: T;
  /** 写入时间戳 (ms) */
  createdAt: number;
  /** 最后访问时间戳 (ms) */
  lastAccessedAt: number;
  /** 过期时间戳 (ms)，0 表示永不过期 */
  expiresAt: number;
  /** 内容指纹 (SHA256)，用于去重 */
  fingerprint: string;
}

// ── LLM 缓存 ──

/** LLM 请求缓存 key 构造参数 */
export interface LlmCacheKeyParams {
  /** 模型名称 */
  model: string;
  /** 完整消息列表（已序列化） */
  messagesText: string;
  /** 工具定义（已序列化） */
  toolsText: string;
  /** reasoning effort (optional, affects output) */
  reasoningEffort?: string;
}

/** LLM 缓存内容 */
export interface LlmCacheValue {
  /** LLM 响应文本 */
  text: string;
  /** 工具调用（如有） */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** token 用量 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** LLM 缓存配置 */
export interface LlmCacheConfig {
  /** 最大条目数，默认 500 */
  maxEntries?: number;
  /** TTL (ms)，默认 10 分钟 */
  ttlMs?: number;
  /** 缓存模式 */
  mode?: "exact" | "fingerprint";
  /** 指纹模式下额外注入的文件哈希集合 */
  fileHashes?: Map<string, string>;
}

// ── 文件哈希缓存 ──

/** 文件哈希条目 */
export interface FileHashEntry {
  /** 文件绝对路径 */
  filePath: string;
  /** SHA256 哈希 */
  hash: string;
  /** 文件大小 (bytes) */
  size: number;
  /** 最后修改时间 (mtimeMs) */
  mtimeMs: number;
  /** 最后检查时间 */
  checkedAt: number;
}

/** 文件哈希缓存配置 */
export interface FileHashCacheConfig {
  /** 最大缓存文件数，默认 2000 */
  maxEntries?: number;
  /** 文件列表 glob 模式 */
  globs?: string[];
  /** 排除 glob 模式 */
  ignoreGlobs?: string[];
}

// ── 记忆缓存层 ──

/** 记忆缓存条目：轻量级线索，不可替代 ground truth */
export interface MemoryCacheEntry {
  /** 记忆 ID */
  id: string;
  /** 语义要点（线索提示，非完整内容） */
  semanticGist: string;
  /** 来源 agentType */
  sourceType: string;
  /** 权重 */
  weight: number;
  /** 写入时间 */
  createdAt: number;
  /** 最后验证时间戳（与 ground truth 对账时更新） */
  lastVerifiedAt: number;
  /** 验证次数 */
  verifyCount: number;
}

/** 记忆缓存配置 */
export interface MemoryCacheConfig {
  /** 最大条目数，默认 1000 */
  maxEntries?: number;
  /** TTL (ms)，默认 7 天 */
  ttlMs?: number;
  /** 自动对账时与 MemoryStore 对比 */
  autoVerify?: boolean;
}

// ── 缓存统计 ──

/** 通用缓存统计 */
export interface CacheStats {
  hits: number;
  misses: number;
  /** 命中率 (字符串百分比) */
  rate: string;
  /** 当前条目数 */
  size: number;
  /** 最大容量 */
  capacity: number;
  /** 驱逐次数 */
  evictions: number;
  /** 过期淘汰次数 */
  expiredEvictions: number;
}

// ── 写入契约 ──

/**
 * 写入契约：
 * - 强一致写入：只有经过 ground truth 验证的数据才允许写入
 * - 最终一致读取：读取不保证最新，但消费方必须二次验证
 *
 * 实现方式：
 * 1. write() → 必须先通过 verify() 验证数据源
 * 2. read() → 返回缓存值 + stale 标记，消费方自行判断
 */
export interface CacheWriteContract<T> {
  /** 写入缓存（仅当 verified=true） */
  write(key: string, value: T, verified: boolean): Promise<void>;
  /** 读取缓存（返回 null 表示未命中或已过期） */
  read(key: string): Promise<{ value: T; stale: boolean } | null>;
}
