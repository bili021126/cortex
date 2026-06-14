// ============================================================
// @cortex/memory-store —— 认知记忆层独立包
//
// v2.6.6: 从 @cortex/engine 拆出纯净认知组件（不含 pipeline 胶水）。
// 底层存储委托 @cortex/memory。
// ============================================================

// ── 记忆中枢（委托模式 Facade） ──────────────────
export { MemoryStore } from "./memory-store.js";

// ── 上下文构建器 ───────────────────────────────
export { ContextBuilder } from "./context-builder.js";
export type { ContextBuildResult } from "./context-builder.js";

// ── 认知引擎 ───────────────────────────────────
export { CognitiveEngine } from "./cognitive-engine.js";
export type { CognitiveConfig, CognitiveScore, ActivatedNode } from "./cognitive-engine.js";
export {
  DEFAULT_COGNITIVE_CONFIG,
  bayesianRelevanceScore,
  fourierTimeDecay,
  timeDecayScore,
  ebbinghausRetention,
  spreadingActivation,
  computeLinkBonus,
  emotionalBonus,
  BoundaryRegressor,
} from "./cognitive-engine.js";

// ── 语义嵌入 ───────────────────────────────────
export { embedText, embedBatch, isModelLoaded, preloadModel, defaultEmbeddingService } from "./embedding.js";
export type { IEmbeddingService } from "./embedding.js";

// ── 纯计算服务 ─────────────────────────────────
export { WeightAger } from "./weight-ager.js";
export type { FreezeCandidate, ObliterateCandidate } from "./weight-ager.js";
export { DedupService } from "./dedup-service.js";
export type { VectorDedupMatch } from "./dedup-service.js";
export { BM25Index, tokenize } from "./bm25-index.js";
export type { BM25Stats, BM25Result, FieldWeights } from "./bm25-index.js";

// ── 混合检索 ───────────────────────────────────
export { HybridRetriever } from "./hybrid-retrieval.js";
export type { HybridRetrievalConfig, HybridScoreResult } from "./hybrid-retrieval.js";
export { DEFAULT_HYBRID_CONFIG, cosineSimilarity, batchCosineSimilarity } from "./hybrid-retrieval.js";

// ── 监控 ───────────────────────────────────────
export { MemoryStoreMonitor } from "./monitor.js";
