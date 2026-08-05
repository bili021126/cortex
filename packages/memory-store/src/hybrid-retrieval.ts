// ============================================================
// hybrid-retrieval.ts —— 混合检索与贪心排序
//
// 融合 BM25 文本评分 + 向量余弦相似度，通过贪心算法和边界回归
// 输出高质量记忆排序列表。组合 BM25Index + IEmbeddingService。
//
// 核心管线:
//   ① 双路召回: BM25 Top-2M + 向量 Top-2M
//   ② 归一化融合: alpha * bm25Norm + beta * cosSim
//   ③ 贪心精排: 粗排池中选 Top-M
//   ④ 边界回归: 自适应阈值裁切低相关尾部
//
// @design 可配置参数组，运行时动态调整
// @complexity 搜索 O(|Q|log|D| + |D|·dim) 其中 dim=384
// ============================================================

import type { IEmbeddingService } from "./embedding.js";
import { EMBEDDING_DIM } from "./schema.js";
import type { MemoryEntry } from "@cortex/shared";
import { RETRIEVAL_ALPHA, RETRIEVAL_BETA, loadEngineDefaults } from "@cortex/config";

// ── 类型 ──────────────────────────────────────

/** 混合检索评分结果 */
export interface HybridScoreResult {
  entry: MemoryEntry;
  bm25Score: number;
  vectorScore: number;
  hybridScore: number;
}

/** 混合检索引擎配置 */
export interface HybridRetrievalConfig {
  /** BM25 权重 (0..1) */
  alpha: number;
  /** 向量相似度权重 (0..1) */
  beta: number;
  /** 粗排池大小倍数 (2M = 2 × topN) */
  coarseMultiplier: number;
  /** 贪心精排目标数 */
  fineTopN: number;
  /** 边界回归: 启用自适应阈值 */
  enableBoundaryRegression: boolean;
  /** 边界回归: 初始阈值 (0..1) */
  initialThreshold: number;
  /** 边界回归: EMA 平滑因子 */
  boundaryEma: number;
}

/** 默认配置（alpha/beta 单源定义 @cortex/config；ENG-2 接入调参覆盖链） */
export const DEFAULT_HYBRID_CONFIG: HybridRetrievalConfig = {
  alpha: loadEngineDefaults().retrievalAlpha ?? RETRIEVAL_ALPHA,
  beta: loadEngineDefaults().retrievalBeta ?? RETRIEVAL_BETA,
  coarseMultiplier: 2,
  fineTopN: 15,
  enableBoundaryRegression: true,
  initialThreshold: 0.15,
  boundaryEma: 0.1,
};

// ── 余弦相似度 ──────────────────────────────

/** 计算两个归一化向量的余弦相似度 */
// R11-11：维度不匹配返回 0 + 警告（此前 Math.min 截断产生静默错误分数——embedding 维度经 env 翻转后旧向量失效）
let _dimsWarned = false;
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    if (!_dimsWarned) {
      console.warn(
        `[memory-store] 向量维度不匹配（${a.length} vs ${b.length}）——embedding 模型/维度变更后旧向量失效，建议重嵌入`,
      );
      _dimsWarned = true;
    }
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    dot += a[i]! * b[i]!;
  }
  return dot; // 假设已归一化，dot ∈ [-1, 1]
}

/** 批量计算余弦相似度 */
export function batchCosineSimilarity(queryVec: number[], vectors: number[][]): number[] {
  return vectors.map((v) => cosineSimilarity(queryVec, v));
}

// ── 评分归一化 ──────────────────────────────

/** Min-max 归一化到 [0, 1] */
function minMaxNormalize(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;
  // R12-P0-2：全同分（含全 0——维度守卫/零命中路径）→ 判 0 而非 0.5——
  // 此前全 0.5 让无关条目以"置信分"通过阈值（initialThreshold < 0.5），且污染自适应阈值
  if (range === 0) return scores.map(() => 0);
  return scores.map((s) => (s - min) / range);
}

// ── 实现 ──────────────────────────────────────

export class HybridRetriever {
  readonly config: HybridRetrievalConfig;

  // ── 边界回归状态 ──
  private _adaptiveThreshold: number;
  private _thresholdHistory: number[] = []; // 最近 N 次使用的阈值

  constructor(config: Partial<HybridRetrievalConfig> = {}) {
    this.config = { ...DEFAULT_HYBRID_CONFIG, ...config };
    this._adaptiveThreshold = this.config.initialThreshold;
  }

  // ── 公开 API ──────────────────────────────

  /**
   * 混合评分——对一批候选记忆进行 BM25 + 向量双重评分。
   *
   * @param candidates 候选记忆列表
   * @param bm25Scores  BM25 索引返回的评分结果 { id, score }
   * @param queryEmbedding 查询文本的向量嵌入（用于余弦相似度）
   * @param embedder 嵌入服务（用于计算候选记忆向量）
   * @returns 混合评分后的记忆列表，按 hybridScore 降序
   */
  async score(
    candidates: MemoryEntry[],
    bm25Scores: Map<string, number>,
    queryEmbedding: number[],
    embedder: IEmbeddingService,
  ): Promise<HybridScoreResult[]> {
    if (candidates.length === 0) return [];

    // ── 提取候选记忆向量 ──
    // R6-C2 fix: 优先使用已存储的 embedding（写入时生成），仅在缺失时重新 ONNX 推理
    const storedVectors: (number[] | undefined)[] = candidates.map((m) => m.embedding);
    const missingIndices: number[] = [];
    const missingTexts: string[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (!storedVectors[i]) {
        missingIndices.push(i);
        missingTexts.push(candidates[i]?.semantic_gist || candidates[i]?.summary || "");
      }
    }
    if (missingTexts.length > 0) {
      const missingVectors = await embedder.embedBatch(missingTexts);
      for (let j = 0; j < missingIndices.length; j++) {
        const idx = missingIndices[j];
        if (idx === undefined) continue;
        storedVectors[idx] = missingVectors[j];
      }
    }
    const candidateVectors = storedVectors.map((v) => v ?? new Array<number>(EMBEDDING_DIM).fill(0));

    // ── 计算余弦相似度 ──
    const cosScores = batchCosineSimilarity(queryEmbedding, candidateVectors);

    // ── 归一化 ──
    const rawBm25: number[] = candidates.map((m) => bm25Scores.get(m.id) ?? 0);
    const bm25Norm = minMaxNormalize(rawBm25);
    const cosNorm = minMaxNormalize(cosScores);

    // ── 加权融合 ──
    const { alpha, beta } = this.config;
    const results: HybridScoreResult[] = [];
    for (let i = 0; i < candidates.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const hybrid = alpha * bm25Norm[i]! + beta * cosNorm[i]!;
      results.push({
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        entry: candidates[i]!,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        bm25Score: rawBm25[i]!,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        vectorScore: cosScores[i]!,
        hybridScore: hybrid,
      });
    }

    // 按混合分降序
    results.sort((a, b) => b.hybridScore - a.hybridScore);
    return results;
  }

  /**
   * 贪心精排: 从已评分的候选池中选取 Top-M，然后按边界回归裁切。
   *
   * 算法:
   *   coarse 池 = 全部候选 (size N)
   *   选取 hybridScore 最高的 fineTopN 条
   *   边界回归裁切: 去掉低于 adaptiveThreshold 的
   *
   * @param scored 已评分的候选
   * @returns 精排后的结果，不超过 fineTopN
   */
  greedyFineRank(scored: HybridScoreResult[]): HybridScoreResult[] {
    if (scored.length === 0) return [];

    // 粗排池 → 取 Top-M
    const fine = scored.slice(0, Math.min(this.config.fineTopN, scored.length));

    // 边界回归裁切
    if (this.config.enableBoundaryRegression) {
      const cutoff = this._adaptiveThreshold;
      const filtered = fine.filter((r) => r.hybridScore >= cutoff);

      // R13-P0-2：空裁切返回空——全 0 分 = 无相关（此前兜底返回 0 分 top-1，调用方不按 hybridScore 过滤会拿到无关记忆）
      if (filtered.length === 0) {
        return [];
      }

      // 更新自适应阈值
      this._updateThreshold(filtered);
      return filtered;
    }

    return fine;
  }

  /**
   * 获取当前自适应阈值。
   */
  get adaptiveThreshold(): number {
    return this._adaptiveThreshold;
  }

  /**
   * 重置边界回归状态。
   */
  resetBoundary(): void {
    this._adaptiveThreshold = this.config.initialThreshold;
    this._thresholdHistory = [];
  }

  // ── 内部 ──────────────────────────────────

  /**
   * 在线边界回归——指数移动平均更新自适应阈值。
   *
   * 策略:
   *   - 记录最近精排中保留条目的最低分
   *   - EMA 更新: newThreshold = oldThreshold + ema * (observedMin - oldThreshold)
   *   - 如果精排结果很少（< 3 条），轻微降低阈值以扩大召回
   */
  private _updateThreshold(results: HybridScoreResult[]): void {
    if (results.length === 0) return;

    // 取被保留条目中的最低分作为观察值
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const observedMin = results[results.length - 1]!.hybridScore;

    // 精排结果少于 3 条时，向更宽松方向调整
    const adjustedObserved = results.length < 3
      ? Math.max(0, observedMin * 0.7)
      : observedMin;

    // EMA 更新
    this._adaptiveThreshold =
      this._adaptiveThreshold + this.config.boundaryEma * (adjustedObserved - this._adaptiveThreshold);

    // 限制在合理范围
    this._adaptiveThreshold = Math.max(0.01, Math.min(0.95, this._adaptiveThreshold));

    // 记录历史
    this._thresholdHistory.push(this._adaptiveThreshold);
    if (this._thresholdHistory.length > 50) {
      this._thresholdHistory.shift();
    }
  }
}
