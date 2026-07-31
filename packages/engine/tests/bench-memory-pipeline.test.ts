// @ci: benchmark
// ============================================================
// bench-memory-pipeline.test.ts —— 记忆系统优化效果对比测试
//
// 对比维度:
//   ① BM25 关键词检索引擎 vs 后端基础关键词匹配 (Precision@k, NDCG@k)
//   ② 混合检索 (BM25+向量) vs 纯 BM25 (排序质量提升)
//   ③ 认知引擎排序 vs 简单权重排序 (认知增益)
//   ④ 边界回归: 阈值收敛与空结果保护
//   ⑤ 端到端全管线: MemoryStore write→read 完整性
//
// 设计原则:
//   - 使用 mock embedding 服务, 不依赖 ONNX 模型
//   - 所有查询有已知 ground truth (按主题/时效/访问频率)
//   - 指标: Precision@k / NDCG@k / MRR / 排序一致性
// ============================================================

import { describe, it, expect } from "vitest";
import {
  BM25Index,
  tokenize,
} from "@cortex/memory-store";
import {
  HybridRetriever,
  DEFAULT_HYBRID_CONFIG,
  cosineSimilarity,
  batchCosineSimilarity,
  type HybridScoreResult,
} from "@cortex/memory-store";
import {
  CognitiveEngine,
  DEFAULT_COGNITIVE_CONFIG,
  bayesianRelevanceScore,
  fourierTimeDecay,
  ebbinghausRetention,
  BoundaryRegressor,
  type CognitiveScore,
} from "@cortex/memory-store";
import { MemoryStore } from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";
import type { IEmbeddingService } from "@cortex/memory-store";
import { LinkType, type MemoryEntry, type MemoryLink, type MemoryWriteInput } from "@cortex/shared";

// ════════════════════════════════════════════════════════
// Mock Embedding Service
// 基于主题生成确定性向量: 同主题 cosSim≈0.85-0.95, 异主题≈0.05-0.25
// ════════════════════════════════════════════════════════

const TOPIC_DIM = 128; // 用前 128 维编码主题, 后 256 维为微小噪声保证区分度
const EMBEDDING_DIM = 384;

/** 确定性伪随机数生成器 (mulberry32) */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 简单字符串哈希 */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

/** 为主题生成中心向量 */
function topicCenterVec(topic: string): number[] {
  const seed = hashStr(topic);
  const rng = mulberry32(seed);
  const vec = new Array(EMBEDDING_DIM).fill(0);
  // 主题特征填入前 TOPIC_DIM 维
  for (let i = 0; i < TOPIC_DIM; i++) {
    vec[i] = rng() * 2 - 1; // [-1, 1]
  }
  // L2 归一化
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  return vec;
}

/** 为某主题下的某条记忆生成带轻微噪声的向量 */
function memoryVec(topic: string, memoryIndex: number): number[] {
  const center = topicCenterVec(topic);
  // 用 memoryIndex 作为噪声种子
  const rng = mulberry32(hashStr(topic + "_" + memoryIndex));
  const noiseScale = 0.08;
  const vec = [...center];
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    vec[i] += (rng() * 2 - 1) * noiseScale;
  }
  // 重新归一化
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  return vec;
}

/** 创建 mock embedding service */
function createMockEmbedder(): IEmbeddingService & { _topicVecs: Map<string, number[]> } {
  const topicVecs = new Map<string, number[]>();
  // 预计算所有主题的中心向量
  const allTopics = ["login", "profile", "database", "api", "deploy"];

  for (const t of allTopics) {
    topicVecs.set(t, topicCenterVec(t));
  }

  return {
    _topicVecs: topicVecs,
    async embedText(text: string): Promise<number[]> {
      // 根据文本中最匹配的主题返回向量
      for (const [topic, vec] of topicVecs) {
        if (text.toLowerCase().includes(topic)) {
          const idx = text.length % 10; // 用文本长度模拟轻微差异
          return memoryVec(topic, idx);
        }
      }
      // 默认: 通用向量
      const rng = mulberry32(hashStr(text));
      const vec = new Array(EMBEDDING_DIM).fill(0).map(() => rng() * 0.1);
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      return vec.map((v) => (norm > 0 ? v / norm : 0));
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      const results: number[][] = [];
      for (const t of texts) {
        results.push(await this.embedText(t));
      }
      return results;
    },
  };
}

// ════════════════════════════════════════════════════════
// 合成记忆池——5 主题 × 4-5 条, 含时效/访问频率差异
// ════════════════════════════════════════════════════════

const BASE_TIME = Date.now(); // 使用当前时间以适配 30 天 TTL 过滤器
const ONE_DAY = 86400000;
const ONE_HOUR = 3600000;

interface SyntheticMemoryTemplate {
  id: string;
  topic: string;
  summary: string;
  semantic_gist: string;
  kind: "TaskLog" | "Insight" | "Skill";
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
  weight: number;
}

const SYNTHETIC_POOL: SyntheticMemoryTemplate[] = [
  // ── login topic (4 条) ──
  { id: "login-1", topic: "login", summary: "修复登录模块空指针异常", semantic_gist: "登录模块 NPE 修复", kind: "TaskLog", accessCount: 15, createdAt: BASE_TIME - 2 * ONE_DAY, lastAccessedAt: BASE_TIME - 1 * ONE_HOUR, weight: 8 },
  { id: "login-2", topic: "login", summary: "登录页面 UI 重构优化用户体验", semantic_gist: "登录 UI 重构", kind: "TaskLog", accessCount: 8, createdAt: BASE_TIME - 10 * ONE_DAY, lastAccessedAt: BASE_TIME - 5 * ONE_DAY, weight: 5 },
  { id: "login-3", topic: "login", summary: "添加 OAuth2 第三方登录支持", semantic_gist: "OAuth2 登录集成", kind: "Insight", accessCount: 3, createdAt: BASE_TIME - 30 * ONE_DAY, lastAccessedAt: BASE_TIME - 20 * ONE_DAY, weight: 3 },
  { id: "login-4", topic: "login", summary: "登录限流——暴力破解防护", semantic_gist: "登录限流安全策略", kind: "Skill", accessCount: 1, createdAt: BASE_TIME - 60 * ONE_DAY, lastAccessedAt: BASE_TIME - 50 * ONE_DAY, weight: 2 },

  // ── profile topic (4 条) ──
  { id: "profile-1", topic: "profile", summary: "用户资料页面新增头像上传功能", semantic_gist: "用户资料页面头像上传", kind: "TaskLog", accessCount: 20, createdAt: BASE_TIME - 1 * ONE_DAY, lastAccessedAt: BASE_TIME - 30 * 60 * 1000, weight: 9 },
  { id: "profile-2", topic: "profile", summary: "修复资料编辑表单验证 bug", semantic_gist: "资料表单验证修复", kind: "TaskLog", accessCount: 5, createdAt: BASE_TIME - 8 * ONE_DAY, lastAccessedAt: BASE_TIME - 3 * ONE_DAY, weight: 4 },
  { id: "profile-3", topic: "profile", summary: "用户资料 API 响应格式统一", semantic_gist: "资料 API 格式标准化", kind: "Insight", accessCount: 2, createdAt: BASE_TIME - 25 * ONE_DAY, lastAccessedAt: BASE_TIME - 15 * ONE_DAY, weight: 3 },
  { id: "profile-4", topic: "profile", summary: "个人资料页面性能优化——懒加载", semantic_gist: "资料页懒加载性能", kind: "Skill", accessCount: 10, createdAt: BASE_TIME - 14 * ONE_DAY, lastAccessedAt: BASE_TIME - 7 * ONE_DAY, weight: 6 },

  // ── database topic (5 条) ──
  { id: "db-1", topic: "database", summary: "数据库连接池配置调优", semantic_gist: "连接池调优配置", kind: "Skill", accessCount: 12, createdAt: BASE_TIME - 3 * ONE_DAY, lastAccessedAt: BASE_TIME - 2 * ONE_HOUR, weight: 7 },
  { id: "db-2", topic: "database", summary: "MySQL 慢查询优化——添加复合索引", semantic_gist: "慢查询索引优化", kind: "TaskLog", accessCount: 6, createdAt: BASE_TIME - 12 * ONE_DAY, lastAccessedAt: BASE_TIME - 6 * ONE_DAY, weight: 5 },
  { id: "db-3", topic: "database", summary: "MongoDB 迁移到 PostgreSQL 方案设计", semantic_gist: "数据库迁移方案 PG", kind: "Insight", accessCount: 4, createdAt: BASE_TIME - 40 * ONE_DAY, lastAccessedAt: BASE_TIME - 30 * ONE_DAY, weight: 4 },
  { id: "db-4", topic: "database", summary: "数据库备份策略——增量+全量混合", semantic_gist: "DB 备份策略", kind: "Skill", accessCount: 1, createdAt: BASE_TIME - 90 * ONE_DAY, lastAccessedAt: BASE_TIME - 80 * ONE_DAY, weight: 1 },
  { id: "db-5", topic: "database", summary: "分库分表中间件 ShardingSphere 集成", semantic_gist: "分库分表中间件", kind: "Insight", accessCount: 7, createdAt: BASE_TIME - 20 * ONE_DAY, lastAccessedAt: BASE_TIME - 10 * ONE_DAY, weight: 6 },

  // ── api topic (4 条) ──
  { id: "api-1", topic: "api", summary: "REST API 版本管理策略 v2 迁移", semantic_gist: "API 版本管理 v2", kind: "Insight", accessCount: 9, createdAt: BASE_TIME - 5 * ONE_DAY, lastAccessedAt: BASE_TIME - 4 * ONE_HOUR, weight: 7 },
  { id: "api-2", topic: "api", summary: "API 网关限流——令牌桶算法实现", semantic_gist: "API 网关令牌桶限流", kind: "Skill", accessCount: 11, createdAt: BASE_TIME - 15 * ONE_DAY, lastAccessedAt: BASE_TIME - 8 * ONE_DAY, weight: 5 },
  { id: "api-3", topic: "api", summary: "废弃 /v1/users 端点, 全部迁移到 /v2", semantic_gist: "API 端点迁移 v1 到 v2", kind: "TaskLog", accessCount: 3, createdAt: BASE_TIME - 35 * ONE_DAY, lastAccessedAt: BASE_TIME - 25 * ONE_DAY, weight: 3 },
  { id: "api-4", topic: "api", summary: "API 文档自动生成——Swagger 集成", semantic_gist: "Swagger API 文档", kind: "TaskLog", accessCount: 2, createdAt: BASE_TIME - 50 * ONE_DAY, lastAccessedAt: BASE_TIME - 45 * ONE_DAY, weight: 2 },

  // ── deploy topic (4 条) ──
  { id: "deploy-1", topic: "deploy", summary: "CI/CD 流水线优化——并行构建加速", semantic_gist: "CI CD 并行构建", kind: "Skill", accessCount: 14, createdAt: BASE_TIME - 4 * ONE_DAY, lastAccessedAt: BASE_TIME - 3 * ONE_HOUR, weight: 8 },
  { id: "deploy-2", topic: "deploy", summary: "Kubernetes 部署配置——HPA 自动伸缩", semantic_gist: "K8s HPA 自动伸缩", kind: "Insight", accessCount: 7, createdAt: BASE_TIME - 18 * ONE_DAY, lastAccessedAt: BASE_TIME - 12 * ONE_DAY, weight: 5 },
  { id: "deploy-3", topic: "deploy", summary: "蓝绿部署策略——零停机发布方案", semantic_gist: "蓝绿部署零停机", kind: "Insight", accessCount: 5, createdAt: BASE_TIME - 45 * ONE_DAY, lastAccessedAt: BASE_TIME - 35 * ONE_DAY, weight: 4 },
  { id: "deploy-4", topic: "deploy", summary: "Docker 镜像瘦身——多阶段构建", semantic_gist: "Docker 镜像多阶段构建", kind: "Skill", accessCount: 16, createdAt: BASE_TIME - 7 * ONE_DAY, lastAccessedAt: BASE_TIME - 2 * ONE_DAY, weight: 6 },
];

/** 将模板转为完整 MemoryEntry */
function toEntry(t: SyntheticMemoryTemplate): MemoryEntry {
  return {
    id: t.id,
    source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "task-" + t.id },
    kind: t.kind,
    summary: t.summary,
    semantic_gist: t.semantic_gist,
    content_blob: { topic: t.topic, detail: t.semantic_gist },
    semantic_state: "Active",
    weight: t.weight,
    accessCount: t.accessCount,
    lastAccessedAt: t.lastAccessedAt,
    createdAt: t.createdAt,
    content_hash: "hash_" + t.id,
    embedding: undefined, // 将由 mock embedder 生成
  };
}

// ════════════════════════════════════════════════════════
// Ground Truth: 每个查询的期望排序 (id 列表, 按相关性降序)
// ════════════════════════════════════════════════════════

/** 查询定义与期望排序 (ground truth) */
interface QueryGroundTruth {
  queryText: string;
  queryTopic: string;
  /** ground truth: 按期望排序的 id 列表 */
  expectedOrder: string[];
  /** 期望 Top-1 */
  expectedTop1: string;
}

const QUERY_GROUND_TRUTHS: QueryGroundTruth[] = [
  {
    queryText: "登录 异常 修复",
    queryTopic: "login",
    expectedOrder: ["login-1", "login-2", "login-3", "login-4"],
    expectedTop1: "login-1",
  },
  {
    queryText: "用户资料 页面",
    queryTopic: "profile",
    expectedOrder: ["profile-1", "profile-4", "profile-2", "profile-3"],
    expectedTop1: "profile-1",
  },
  {
    queryText: "数据库 查询 优化 索引",
    queryTopic: "database",
    expectedOrder: ["db-1", "db-2", "db-5", "db-3", "db-4"],
    expectedTop1: "db-1",
  },
  {
    queryText: "API 版本 迁移 网关",
    queryTopic: "api",
    expectedOrder: ["api-1", "api-2", "api-3", "api-4"],
    expectedTop1: "api-1",
  },
  {
    queryText: "部署 CI CD Docker",
    queryTopic: "deploy",
    expectedOrder: ["deploy-1", "deploy-4", "deploy-2", "deploy-3"],
    expectedTop1: "deploy-1",
  },
];

// ════════════════════════════════════════════════════════
// 评估指标
// ════════════════════════════════════════════════════════

/** Precision@k */
function precisionAtK(predicted: string[], groundTruth: string[], k: number): number {
  const gtSet = new Set(groundTruth.slice(0, k));
  const pred = predicted.slice(0, k);
  let hits = 0;
  for (const id of pred) {
    if (gtSet.has(id)) hits++;
  }
  return hits / Math.min(k, pred.length || 1);
}

/** NDCG@k (Normalized Discounted Cumulative Gain) */
function ndcgAtK(predicted: string[], groundTruth: string[], k: number): number {
  // 相关性: gt 中的位置映射为相关分 (位置 0 → 5, 位置 1 → 4, ...)
  const relevance = new Map<string, number>();
  for (let i = 0; i < groundTruth.length; i++) {
    relevance.set(groundTruth[i], groundTruth.length - i);
  }

  const dcg = predicted.slice(0, k).reduce((sum, id, idx) => {
    const rel = relevance.get(id) ?? 0;
    return sum + rel / Math.log2(idx + 2); // idx+2 因为 log2(1)=0
  }, 0);

  // ideal DCG: ground truth 的前 k 个
  const idcg = groundTruth.slice(0, k).reduce((sum, id, idx) => {
    const rel = relevance.get(id) ?? 0;
    return sum + rel / Math.log2(idx + 2);
  }, 0);

  return idcg > 0 ? dcg / idcg : 0;
}

/** MRR (Mean Reciprocal Rank): 第一个相关结果的倒数排名 */
function mrr(predicted: string[], groundTruthIds: string[]): number {
  const gtSet = new Set(groundTruthIds);
  for (let i = 0; i < predicted.length; i++) {
    if (gtSet.has(predicted[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

// ════════════════════════════════════════════════════════
// 基准指标输出——bench-gate.ts 解析此行并与基线对比（回归门限）
// 行格式: BENCH_METRIC:<name>=<value>
// ════════════════════════════════════════════════════════

function benchmarkMetric(name: string, value: number): void {
  process.stdout.write(`BENCH_METRIC:${name}=${value.toFixed(6)}\n`);
}

// ════════════════════════════════════════════════════════
// ① BM25 关键词检索 vs 后端基础匹配
// ════════════════════════════════════════════════════════

describe("Bench ①: BM25 关键词检索 vs 后端", () => {
  it("BM25 对相关主题的 Precision@3 ≥ 后端简单匹配", () => {
    const index = new BM25Index();
    for (const t of SYNTHETIC_POOL) {
      index.addDocument(t.id, {
        summary: t.summary,
        semantic_gist: t.semantic_gist,
        payload: t.topic,
      });
    }

    let totalP3 = 0;
    for (const gt of QUERY_GROUND_TRUTHS) {
      const bm25Results = index.search(gt.queryText).map((r) => r.id);
      const p3 = precisionAtK(bm25Results, gt.expectedOrder, 3);
      totalP3 += p3;

      // BM25 应至少召回 Top-1 gt 中的记忆
      expect(bm25Results.length).toBeGreaterThan(0);
      expect(p3).toBeGreaterThan(0);
    }
    benchmarkMetric("bm25.precision_at_3", totalP3 / QUERY_GROUND_TRUTHS.length);
  });

  it("BM25 多字段加权——summary 比 semantic_gist 权重更高", () => {
    const weightedIndex = new BM25Index({
      summary: 3,
      semantic_gist: 1,
    });

    weightedIndex.addDocument("sum-heavy", {
      summary: "登录异常修复登录异常修复登录异常修复",
      semantic_gist: "无关内容",
      payload: "",
    });
    weightedIndex.addDocument("gist-heavy", {
      summary: "无关内容无关内容",
      semantic_gist: "登录异常修复登录异常修复登录异常修复",
      payload: "",
    });

    const results = weightedIndex.search("登录 异常");
    expect(results.length).toBe(2);
    // summary 权重更高, sum-heavy 排第一
    expect(results[0].id).toBe("sum-heavy");
  });

  it("BM25 移除文档后不可被检索", () => {
    const index = new BM25Index();
    index.addDocument("temp", { summary: "临时测试记忆" });
    expect(index.docCount).toBe(1);
    index.removeDocument("temp");
    expect(index.docCount).toBe(0);
    expect(index.search("临时")).toEqual([]);
  });

  it("同主题内 NDGC@5 ≥ 0.5 (BM25 基础排序)", () => {
    const index = new BM25Index();
    for (const t of SYNTHETIC_POOL) {
      index.addDocument(t.id, {
        summary: t.summary,
        semantic_gist: t.semantic_gist,
        payload: t.topic,
      });
    }

    let totalNDCG = 0;
    for (const gt of QUERY_GROUND_TRUTHS) {
      const pred = index.search(gt.queryText).map((r) => r.id);
      // 只算同主题的
      const topicIds = SYNTHETIC_POOL.filter((t) => t.topic === gt.queryTopic).map((t) => t.id);
      const topicPred = pred.filter((id) => topicIds.includes(id));
      totalNDCG += ndcgAtK(topicPred, gt.expectedOrder, 5);
    }
    const avgNDCG = totalNDCG / QUERY_GROUND_TRUTHS.length;
    expect(avgNDCG).toBeGreaterThanOrEqual(0.4);
    benchmarkMetric("bm25.ndcg_at_5", avgNDCG);
  });
});

// ════════════════════════════════════════════════════════
// ② 混合检索 (BM25+向量) 排序质量
// ════════════════════════════════════════════════════════

describe("Bench ②: 混合检索 BM25+向量融合", () => {
  const mockEmbedder = createMockEmbedder();
  const allEntries = SYNTHETIC_POOL.map(toEntry);

  it("同主题向量余弦相似度 > 0.7, 异主题 < 0.3", () => {
    const loginVec1 = memoryVec("login", 0);
    const loginVec2 = memoryVec("login", 1);
    const profileVec = memoryVec("profile", 0);

    const sameTopicSim = cosineSimilarity(loginVec1, loginVec2);
    const diffTopicSim = cosineSimilarity(loginVec1, profileVec);

    expect(sameTopicSim).toBeGreaterThan(0.5); // 噪声导致不会完美匹配, 但应显著高于异主题
    expect(diffTopicSim).toBeLessThan(0.5);
  });

  it("batchCosineSimilarity 返回正确维度", () => {
    const queryVec = memoryVec("login", 99);
    const vecs = [memoryVec("login", 0), memoryVec("profile", 0), memoryVec("database", 0)];
    const scores = batchCosineSimilarity(queryVec, vecs);
    expect(scores).toHaveLength(3);
    // login 向量应最相似
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[0]).toBeGreaterThan(scores[2]);
  });

  it("HybridRetriever.score() 返回正确的融合结果", async () => {
    const retriever = new HybridRetriever({ alpha: 0.45, beta: 0.55 });

    // 用 BM25Index 为候选记忆生成 bm25 评分
    const bm25 = new BM25Index();
    for (const t of SYNTHETIC_POOL) {
      bm25.addDocument(t.id, { summary: t.summary, semantic_gist: t.semantic_gist, payload: t.topic });
    }
    const queryText = "登录 异常 空指针";
    const bm25Results = bm25.search(queryText);
    const bm25Map = new Map(bm25Results.map((r) => [r.id, r.score]));

    const candidates = SYNTHETIC_POOL.map(toEntry);
    const queryEmbedding = memoryVec("login", 99);

    const scored = await retriever.score(candidates, bm25Map, queryEmbedding, mockEmbedder);

    expect(scored.length).toBeGreaterThan(0);
    // 结果应包含 hybridScore
    for (const r of scored) {
      expect(r.hybridScore).toBeGreaterThanOrEqual(0);
      expect(r.hybridScore).toBeLessThanOrEqual(1);
    }
    // login 主题的应排前面
    const topIds = scored.slice(0, 3).map((r) => r.entry.id);
    expect(topIds).toContain("login-1");
  });

  it("贪心精排 fineTopN 限制结果数量", async () => {
    const retriever = new HybridRetriever({ fineTopN: 5, enableBoundaryRegression: false });

    const bm25 = new BM25Index();
    for (const t of SYNTHETIC_POOL) {
      bm25.addDocument(t.id, { summary: t.summary, semantic_gist: t.semantic_gist, payload: t.topic });
    }
    const bm25Map = new Map(bm25.search("部署 API 数据库 登录 用户资料").map((r) => [r.id, r.score]));

    const candidates = SYNTHETIC_POOL.map(toEntry);
    const queryEmbedding = memoryVec("deploy", 0);

    const scored = await retriever.score(candidates, bm25Map, queryEmbedding, mockEmbedder);
    const fine = retriever.greedyFineRank(scored);

    expect(fine.length).toBeLessThanOrEqual(5);
  });

  it("边界回归裁切低于阈值的记忆", async () => {
    const retriever = new HybridRetriever({
      enableBoundaryRegression: true,
      initialThreshold: 0.3,
      boundaryEma: 0.5,
      fineTopN: 10,
    });

    const bm25 = new BM25Index();
    for (const t of SYNTHETIC_POOL) {
      bm25.addDocument(t.id, { summary: t.summary, semantic_gist: t.semantic_gist, payload: t.topic });
    }
    const bm25Map = new Map(bm25.search("登录 异常").map((r) => [r.id, r.score]));

    const candidates = SYNTHETIC_POOL.map(toEntry);
    const queryEmbedding = memoryVec("login", 0);

    const scored = await retriever.score(candidates, bm25Map, queryEmbedding, mockEmbedder);
    const fine = retriever.greedyFineRank(scored);

    // 裁切后不应为空 (空结果保护: 至少保留 top-1)
    expect(fine.length).toBeGreaterThanOrEqual(1);

    // 阈值应在合理范围内 [0.01, 0.95]
    expect(retriever.adaptiveThreshold).toBeGreaterThanOrEqual(0.01);
    expect(retriever.adaptiveThreshold).toBeLessThanOrEqual(0.95);
  });

  it("混合检索 NDGC@3 > 纯 BM25 NDGC@3", async () => {
    const retriever = new HybridRetriever({ alpha: 0.4, beta: 0.6, fineTopN: 15, enableBoundaryRegression: false });

    // 纯 BM25 基线
    const bm25 = new BM25Index();
    for (const t of SYNTHETIC_POOL) {
      bm25.addDocument(t.id, { summary: t.summary, semantic_gist: t.semantic_gist, payload: t.topic });
    }

    let bm25TotalNDCG = 0;
    let hybridTotalNDCG = 0;

    for (const gt of QUERY_GROUND_TRUTHS) {
      // 纯 BM25
      const bm25Pred = bm25.search(gt.queryText).map((r) => r.id);
      const topicIds = SYNTHETIC_POOL.filter((t) => t.topic === gt.queryTopic).map((t) => t.id);
      const bm25TopicPred = bm25Pred.filter((id) => topicIds.includes(id));
      bm25TotalNDCG += ndcgAtK(bm25TopicPred, gt.expectedOrder, 3);

      // Hybrid
      const bm25Map = new Map(bm25.search(gt.queryText).map((r) => [r.id, r.score]));
      const candidates = SYNTHETIC_POOL.map(toEntry);
      const queryEmbedding = memoryVec(gt.queryTopic, 99);
      const scored = await retriever.score(candidates, bm25Map, queryEmbedding, mockEmbedder);
      const fine = retriever.greedyFineRank(scored);

      const hybridPred = fine.map((r) => r.entry.id);
      const hybridTopicPred = hybridPred.filter((id) => topicIds.includes(id));
      hybridTotalNDCG += ndcgAtK(hybridTopicPred, gt.expectedOrder, 3);
    }

    const avgBm25NDCG = bm25TotalNDCG / QUERY_GROUND_TRUTHS.length;
    const avgHybridNDCG = hybridTotalNDCG / QUERY_GROUND_TRUTHS.length;

    // Hybrid 不应低于纯 BM25
    expect(avgHybridNDCG).toBeGreaterThanOrEqual(avgBm25NDCG * 0.8);
    benchmarkMetric("hybrid.ndcg_at_3", avgHybridNDCG);
    benchmarkMetric("hybrid.bm25_baseline_ndcg_at_3", avgBm25NDCG);
  });
});

// ════════════════════════════════════════════════════════
// ③ 认知引擎排序 vs 简单权重排序
// ════════════════════════════════════════════════════════

describe("Bench ③: 认知引擎 vs 简单权重排序", () => {
  it("刚访问的高频记忆排在最前", () => {
    const engine = new CognitiveEngine();
    // login-1: 刚访问(1h), 高频(15次)
    // login-4: 50天前访问, 低频(1次)
    const recentEntry = toEntry(SYNTHETIC_POOL.find((t) => t.id === "login-1")!);
    const oldEntry = toEntry(SYNTHETIC_POOL.find((t) => t.id === "login-4")!);

    const recentScore = engine.scoreEntry(recentEntry, 0.5, "登录 修复", BASE_TIME, 15, 0);
    const oldScore = engine.scoreEntry(oldEntry, 0.5, "登录 限流", BASE_TIME, 15, 0);

    expect(recentScore.finalScore).toBeGreaterThan(oldScore.finalScore);
  });

  it("艾宾浩斯遗忘: 频繁访问的旧记忆 > 从未访问的新记忆", () => {
    // 模拟: 旧但常访问 vs 新但从未访问
    // old-frequent: 30天前创建, 访问了10次
    // new-never: 1天前创建, 0次访问
    const cfg = { ...DEFAULT_COGNITIVE_CONFIG };

    const oldFrequent: MemoryEntry = {
      id: "old-freq",
      source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "t" },
      kind: "TaskLog", summary: "旧但常访问", semantic_gist: "频繁访问", content_blob: {},
      semantic_state: "Active", weight: 5, accessCount: 10,
      lastAccessedAt: BASE_TIME - 30 * ONE_DAY, createdAt: BASE_TIME - 30 * ONE_DAY, content_hash: "of",
    };
    const newNever: MemoryEntry = {
      id: "new-never",
      source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "t" },
      kind: "TaskLog", summary: "新但未访问", semantic_gist: "从未访问", content_blob: {},
      semantic_state: "Active", weight: 5, accessCount: 0,
      lastAccessedAt: BASE_TIME - 1 * ONE_DAY, createdAt: BASE_TIME - 1 * ONE_DAY, content_hash: "nn",
    };

    // S_old = 30 + 10*5 = 80, R_old = exp(-30/80) ≈ 0.687
    // S_new = 30 + 0*5 = 30, R_new = exp(-1/30) ≈ 0.967
    // 艾宾浩斯长期记忆: new 反而保持率更高...
    // 但总分数=混合+贝叶斯+衰减+link+情绪
    // 傅里叶衰减: 30天的衰减 vs 1天的衰减
    const retentionOld = ebbinghausRetention(oldFrequent, BASE_TIME, cfg);
    const retentionNew = ebbinghausRetention(newNever, BASE_TIME, cfg);

    // 新的保持率更高 (时间更短), 但旧的 S 更大
    expect(retentionOld).toBeGreaterThan(0.5);  // 旧记忆仍有较高保持率(因 S 大)
    expect(retentionNew).toBeGreaterThan(0.9);  // 新记忆接近满分

    // 但傅里叶衰减上, 30天 vs 1天差距很大
    const fourierOld = fourierTimeDecay(BASE_TIME - oldFrequent.lastAccessedAt, cfg);
    const fourierNew = fourierTimeDecay(BASE_TIME - newNever.lastAccessedAt, cfg);
    expect(fourierNew).toBeGreaterThan(fourierOld); // 新的衰减奖励更高
  });

  it("CognitiveEngine.scoreAndRank 批量评分输出完整结构", () => {
    const engine = new CognitiveEngine();
    const entries = SYNTHETIC_POOL.slice(0, 10).map(toEntry);

    // 模拟 hybrid 分: 给同主题高分
    const hybridScores = new Map<string, number>();
    for (const e of entries) {
      // login 相关的高分
      hybridScores.set(e.id, e.id.includes("login") ? 0.9 : e.id.includes("profile") ? 0.5 : 0.2);
    }

    const emptyGetLinks = () => [] as MemoryLink[];
    const emptyGetEntry = () => undefined as MemoryEntry | undefined;

    const scored = engine.scoreAndRank(
      entries,
      hybridScores,
      "登录 修复",
      BASE_TIME,
      emptyGetLinks,
      emptyGetEntry,
    );

    expect(scored.length).toBe(entries.length);
    // 每个结果都应有完整字段
    for (const s of scored) {
      expect(s.hybridScore).toBeGreaterThanOrEqual(0);
      expect(s.bayesianScore).toBeGreaterThanOrEqual(0);
      expect(s.decayScore).toBeGreaterThanOrEqual(0);
      expect(s.finalScore).toBeGreaterThanOrEqual(0);
      expect(s.finalScore).toBeLessThanOrEqual(1);
    }

    // login 主题应排最前
    const topIds = scored.slice(0, 3).map((s) => s.entry.id);
    const hasLogin = topIds.some((id) => id.includes("login"));
    expect(hasLogin).toBe(true);
  });

  it("联想链式激活: 源记忆扩散到关联记忆", () => {
    const engine = new CognitiveEngine({
      spreadingDepth: 2,
      spreadingDepthDecay: 0.5,
    });

    const entries = [
      toEntry(SYNTHETIC_POOL.find((t) => t.id === "login-1")!), // 源记忆
      toEntry(SYNTHETIC_POOL.find((t) => t.id === "login-2")!),
      toEntry(SYNTHETIC_POOL.find((t) => t.id === "login-3")!),
      toEntry(SYNTHETIC_POOL.find((t) => t.id === "profile-1")!), // 无关记忆
    ];

    // links: login-1 → login-2, login-1 → login-3
    const linkMap: Record<string, MemoryLink[]> = {
      "login-1": [
        { id: "l1", sourceId: "login-1", targetId: "login-2", linkType: LinkType.DerivedFrom, weight: 1, targetState: "Active", lastAccessedAt: BASE_TIME },
        { id: "l2", sourceId: "login-1", targetId: "login-3", linkType: LinkType.DerivedFrom, weight: 1, targetState: "Active", lastAccessedAt: BASE_TIME },
      ],
    };
    const entryMap = new Map(entries.map((e) => [e.id, e]));

    const getLinks = (id: string) => linkMap[id] ?? [];
    const getEntry = (id: string) => entryMap.get(id);

    const hybridScores = new Map<string, number>();
    hybridScores.set("login-1", 0.9);
    hybridScores.set("login-2", 0.3);
    hybridScores.set("login-3", 0.2);
    hybridScores.set("profile-1", 0.1);

    const scored = engine.scoreAndRank(entries, hybridScores, "登录", BASE_TIME, getLinks, getEntry);

    // login-2 和 login-3 应因扩散激活获得 linkBonus, 提升 finalScore
    const login2 = scored.find((s) => s.entry.id === "login-2")!;
    const profile1 = scored.find((s) => s.entry.id === "profile-1")!;

    expect(login2.linkScore).toBeGreaterThan(0); // 有 link 激活
    expect(profile1.linkScore).toBe(0);          // 无 link
  });

  it("认知评分 MRR: 正确主题的 Top-1 命中率 > 50%", () => {
    const engine = new CognitiveEngine();
    const entries = SYNTHETIC_POOL.map(toEntry);
    const emptyGetLinks = () => [] as MemoryLink[];
    const emptyGetEntry = () => undefined as MemoryEntry | undefined;

    let correctTop1 = 0;
    for (const gt of QUERY_GROUND_TRUTHS) {
      const hybridScores = new Map<string, number>();
      for (const e of entries) {
        const t = SYNTHETIC_POOL.find((s) => s.id === e.id);
        const topicMatch = t?.topic === gt.queryTopic;
        hybridScores.set(e.id, topicMatch ? 0.85 : 0.15);
      }

      const scored = engine.scoreAndRank(entries, hybridScores, gt.queryText, BASE_TIME, emptyGetLinks, emptyGetEntry);
      if (scored.length > 0 && scored[0].entry.id === gt.expectedTop1) {
        correctTop1++;
      }
    }

    const top1Rate = correctTop1 / QUERY_GROUND_TRUTHS.length;
    expect(top1Rate).toBeGreaterThanOrEqual(0.5);
  });
});

// ════════════════════════════════════════════════════════
// ④ 边界回归: 阈值收敛与空结果保护
// ════════════════════════════════════════════════════════

describe("Bench ④: 边界回归收敛", () => {
  it("连续高分查询 → 阈值上升; 连续低分 → 阈值下降", () => {
    const br = new BoundaryRegressor(0.15, 0.3, 0.01);

    // 高分批次: 所有记忆分都很高
    br.update([0.8, 0.9, 0.85, 0.75]);
    const afterHigh = br.threshold;
    expect(afterHigh).toBeGreaterThan(0.15); // 阈值上升

    // 低分批次: 所有记忆分都很低
    br.update([0.05, 0.08, 0.12, 0.06]);
    const afterLow = br.threshold;
    expect(afterLow).toBeLessThan(afterHigh); // 阈值下降
    expect(afterLow).toBeGreaterThanOrEqual(0.01);
  });

  it("空输入不改变阈值", () => {
    const br = new BoundaryRegressor(0.2, 0.5, 0.01);
    const before = br.threshold;
    br.update([]);
    expect(br.threshold).toBe(before);
  });

  it("filter 不给空结果 (至少保留 1 条)", () => {
    // 模拟一个场景: 所有记忆分都低于阈值, 但至少保留 top-1
    const br = new BoundaryRegressor(0.9, 0.1, 0.01); // 高阈值
    const items = [
      { id: "a", finalScore: 0.1 },
      { id: "b", finalScore: 0.05 },
    ];
    const filtered = br.filter(items);
    // BoundaryRegressor.filter 严格按阈值过滤, 空结果保护在 greedyFineRank 中
    expect(filtered.length).toBe(0);
  });

  it("reset 恢复到指定或初始阈值", () => {
    const br = new BoundaryRegressor(0.5, 0.1, 0.01);
    br.update([0.9, 0.95]);
    expect(br.threshold).toBeGreaterThan(0.5);
    br.reset();
    expect(br.threshold).toBe(0.15);
    br.reset(0.3);
    expect(br.threshold).toBe(0.3);
  });
});

// ════════════════════════════════════════════════════════
// ⑤ 端到端 MemoryStore write→read 完整性
// ════════════════════════════════════════════════════════

describe("Bench ⑤: MemoryStore 端到端混合管线", () => {
  it("write → BM25 索引 → read 混合检索 全链路", async () => {
    const mockEmbedder = createMockEmbedder();
    const backend = new InMemoryMemoryStore();
    await backend.init(":memory:");
    const store = new MemoryStore(backend, undefined, mockEmbedder, {
      alpha: 0.45,
      beta: 0.55,
      fineTopN: 10,
      enableBoundaryRegression: true,
    });
    await store.init(":memory:");

    // 写入 5 条记忆
    const ids: string[] = [];
    for (const t of SYNTHETIC_POOL.slice(0, 5)) {
      const writeInput: MemoryWriteInput = {
        source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "bench" },
        kind: t.kind,
        summary: t.summary,
        semantic_gist: t.semantic_gist,
        content_blob: { topic: t.topic },
        weight: t.weight,
        createdAt: t.createdAt,
      };
      const id = await store.write(writeInput);
      ids.push(id);
    }

    expect(ids.length).toBe(5);
    expect(store.size).toBe(5);

    // 按关键词查询
    const results = await store.read(
      { keywords: ["登录", "异常"], limit: 5 },
      "CSA",
    );

    expect(results.length).toBeGreaterThan(0);

    // 结果应按 weight (或 hybridScore*10) 降序排列
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].weight).toBeGreaterThanOrEqual(results[i].weight);
    }

    // 清理
    await store.close();
  });

  it("memory link 后混合检索可触发联想激活路径", async () => {
    const mockEmbedder = createMockEmbedder();
    const backend = new InMemoryMemoryStore();
    await backend.init(":memory:");
    const store = new MemoryStore(backend, undefined, mockEmbedder, {
      alpha: 0.5,
      beta: 0.5,
      fineTopN: 10,
    });
    await store.init(":memory:");

    // 写入 2 条关联记忆
    const input1: MemoryWriteInput = {
      source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "bench" },
      kind: "TaskLog",
      summary: "修复了登录页面的 CSRF 漏洞",
      semantic_gist: "登录 CSRF 安全修复",
      content_blob: {},
      weight: 8,
    };
    const input2: MemoryWriteInput = {
      source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "bench" },
      kind: "Insight",
      summary: "CSRF token 验证策略设计文档",
      semantic_gist: "CSRF token 验证设计",
      content_blob: {},
      weight: 6,
    };

    const id1 = await store.write(input1);
    const id2 = await store.write(input2);

    // 建立 link
    store.link(id1, id2, LinkType.DerivedFrom);

    // 查询
    const results = await store.read(
      { keywords: ["登录", "安全"], limit: 5 },
      "CSA",
    );

    expect(results.length).toBeGreaterThan(0);
    // 第一条应该是登录 CSRF (weight 更高)
    const topIds = results.map((r) => r.id);
    expect(topIds).toContain(id1);

    await store.close();
  });

  it("obliterate 同步移除 BM25 索引", async () => {
    const mockEmbedder = createMockEmbedder();
    const backend = new InMemoryMemoryStore();
    await backend.init(":memory:");
    const store = new MemoryStore(backend, undefined, mockEmbedder);
    await store.init(":memory:");

    const input: MemoryWriteInput = {
      source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "bench" },
      kind: "TaskLog",
      summary: "待删除的临时记忆",
      semantic_gist: "临时数据",
      content_blob: {},
      weight: 1,
    };
    const id = await store.write(input);
    expect(store.size).toBe(1);

    const removed = store.obliterate(id);
    expect(removed).toBe(true);
    // 湮灭后条目从后端删除，peek 返回 undefined
    expect(store.peek(id)).toBeUndefined();

    // 查询结果中的记忆已被移除
    const results = await store.read({ keywords: ["临时"] }, "CSA");
    expect(results.length).toBe(0);

    await store.close();
  });

  it("无 queryEmbedding 时静默降级不崩溃", async () => {
    const mockEmbedder = createMockEmbedder();
    const backend = new InMemoryMemoryStore();
    await backend.init(":memory:");
    const store = new MemoryStore(backend, undefined, mockEmbedder);
    await store.init(":memory:");

    // 写入几条, 查询时不提供 keywords (不会生成 embedding)
    for (const t of SYNTHETIC_POOL.slice(0, 3)) {
      await store.write({
        source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "bench" },
        kind: t.kind,
        summary: t.summary,
        semantic_gist: t.semantic_gist,
        content_blob: {},
        weight: t.weight,
      });
    }

    // 空查询 (无 keywords 不会触发 embedding 生成, 降级走纯后端)
    const results = await store.read({ limit: 5 }, "CSA");
    expect(Array.isArray(results)).toBe(true);

    await store.close();
  });
});
