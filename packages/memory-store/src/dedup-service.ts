// ============================================================
// @cortex/engine/memory/dedup-service —— 内容去重服务
//
// @since v3.1.0
// @layer 引擎层 — 纯计算 + observer emit，不操作存储
//
// 职责：
//   1. contentHash()   — SHA256 内容哈希
//   2. vectorDedup()   — 向量余弦相似度去重
//   3. exactMatch()    — content_hash 精确匹配去重
//
// 从 memory-store.ts 拆分，遵循单一职责原则。
//
// @fix FIND-030 — contentHash 结果在 write() 中通过 content_hash 字段持久化
// @fix FIND-029 — embedding 统一存储为 number[]（与 _parseEmbeddingBlob 对齐）
// ============================================================

import * as crypto from "node:crypto";
import type { MemoryEntry } from "@cortex/shared";
import {
  CONTENT_HASH_ALGO,
  VECTOR_DEDUP_THRESHOLD,
} from "./schema.js";

/** 向量去重匹配结果 */
export interface VectorDedupMatch {
  /** 匹配到的已有条目 ID */
  existingId: string;
  /** 余弦相似度 */
  similarity: number;
}

/**
 * DedupService —— 内容去重纯计算服务。
 *
 * 不持有状态，不操作存储层，仅对传入的条目执行去重计算。
 */
export class DedupService {
  private readonly hashAlgo: string;
  private readonly vectorThreshold: number;

  constructor(
    hashAlgo: string = CONTENT_HASH_ALGO,
    vectorThreshold: number = VECTOR_DEDUP_THRESHOLD,
  ) {
    this.hashAlgo = hashAlgo;
    this.vectorThreshold = vectorThreshold;
  }

  /**
   * 计算内容 SHA256 哈希。
   * 哈希输入 = summary + JSON(content_blob)，确保内容唯一性。
   *
   * @param summary 记忆摘要
   * @param contentBlob 内容体
   * @returns 十六进制哈希字符串
   */
  contentHash(summary: string, contentBlob: unknown): string {
    return crypto
      .createHash(this.hashAlgo)
      .update(summary + JSON.stringify(contentBlob))
      .digest("hex");
  }

  /**
   * 在已有条目中按 contentHash 精确匹配去重。
   *
   * @param contentHash 待查找的内容哈希
   * @param entries 已有条目池
   * @returns 匹配到的条目 ID，null 表示无重复
   */
  exactMatch(contentHash: string, entries: MemoryEntry[]): string | null {
    const dup = entries.find((e) => e.content_hash === contentHash);
    return dup?.id ?? null;
  }

  /**
   * 向量余弦相似度去重。
   * 计算新向量与所有已有向量的余弦相似度，>= threshold 视为重复。
   *
   * @param newEmbedding 新条目的 embedding 向量
   * @param entries 已有条目池
   * @returns 超过阈值的匹配列表（按相似度降序）
   */
  vectorDedup(
    newEmbedding: number[],
    entries: MemoryEntry[],
  ): VectorDedupMatch[] {
    const matches: VectorDedupMatch[] = [];
    const magA = Math.sqrt(newEmbedding.reduce((s, v) => s + v * v, 0));
    if (magA === 0) return matches;

    for (const e of entries) {
      if (e.embedding?.length !== newEmbedding.length) continue;
      const emb = e.embedding;
      const dot = newEmbedding.reduce(
        (sum, v, i) => sum + v * (emb[i] ?? 0),
        0,
      );
      const magB = Math.sqrt(
        e.embedding.reduce((s, v) => s + v * v, 0),
      );
      if (magB === 0) continue;
      const cos = dot / (magA * magB);
      if (cos >= this.vectorThreshold) {
        matches.push({ existingId: e.id, similarity: cos });
      }
    }

    // 按相似度降序排列
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches;
  }
}
