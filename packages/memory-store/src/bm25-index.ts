// ============================================================
// bm25-index.ts —— 轻量 BM25 全文索引
//
// 基于 Okapi BM25 算法的纯内存全文索引，为混合检索提供
// 关键词匹配评分。支持多字段加权、动态增删文档。
//
// 核心公式:
//   BM25(D,Q) = Σ IDF(qi) * TF(qi,D) * (k1+1) / (TF(qi,D) + k1 * (1 - b + b * |D|/avgDL))
//
// @design 零依赖，无外部分词器——使用 Unicode 分词 + 停用词过滤
// @complexity 写入 O(1) 分摊，搜索 O(|Q| * log|D|)
// ============================================================

// ── 类型 ──────────────────────────────────────

/** BM25 索引统计快照 */
export interface BM25Stats {
  docCount: number;
  avgDocLength: number;
  totalTerms: number;
}

/** 单字段 BM25 搜索结果 */
export interface BM25Result {
  id: string;
  score: number;
}

/** 字段权重配置 */
export interface FieldWeights {
  summary?: number;
  semantic_gist?: number;
  payload?: number;
}

// ── 常量 ──────────────────────────────────────
// 权威源：@cortex/config BM25_DEFAULT_K1 / BM25_DEFAULT_B
// 本地镜像避免跨包依赖（bm25-index 本身在 memory-store 内）
import { BM25_DEFAULT_K1, BM25_DEFAULT_B } from "@cortex/config";

const DEFAULT_K1 = BM25_DEFAULT_K1;
const DEFAULT_B = BM25_DEFAULT_B;

/** 停用词集合——中文高频虚词 + 英文 stopwords */
const STOP_WORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
  "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
  "自己", "这", "他", "她", "它", "们", "那", "些", "什么", "怎么", "哪", "吗",
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall", "should",
  "may", "might", "can", "could", "to", "of", "in", "for", "on", "with",
  "at", "by", "from", "as", "into", "through", "during", "before", "after",
  "and", "but", "or", "not", "no", "if", "then", "else", "when", "where",
  "this", "that", "these", "those", "it", "its", "all", "each", "every",
]);

// ── 分词 ──────────────────────────────────────

/**
 * 简单 Unicode 分词——按 Unicode 单词边界切分。
 * 中文逐字切分（单字作为 token），英文/数字按空白和标点切分。
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];
  const re = /[\p{Script=Han}]|[a-zA-Z0-9]+/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const t = match[0].toLowerCase();
    if (!STOP_WORDS.has(t) && t.length > 0) {
      tokens.push(t);
    }
  }
  return tokens;
}

// ── 实现 ──────────────────────────────────────

/** 内部文档元数据 */
interface DocMeta {
  id: string;
  fields: Map<string, string>; // fieldName → raw text
  fieldTokens: Map<string, string[]>; // fieldName → tokenized
  /** M3 fix: 预计算每字段 TF——避免每次搜索重新计算 */
  fieldTf: Map<string, Map<string, number>>; // fieldName → (token → tf)
  totalTokens: number;
}

export class BM25Index {
  // ── 参数 ──
  private readonly k1: number;
  private readonly b: number;
  private readonly fieldWeights: Map<string, number>;

  // ── 索引数据 ──
  private _docs: Map<string, DocMeta> = new Map();
  private _termDocFreq: Map<string, number> = new Map(); // term → 包含它的文档数
  private _totalTokens = 0;
  private _docCount = 0;

  constructor(
    fieldWeights: FieldWeights = {},
    k1 = DEFAULT_K1,
    b = DEFAULT_B,
  ) {
    this.k1 = k1;
    this.b = b;
    this.fieldWeights = new Map<string, number>();
    this.fieldWeights.set("summary", fieldWeights.summary ?? 2);
    this.fieldWeights.set("semantic_gist", fieldWeights.semantic_gist ?? 1);
    this.fieldWeights.set("payload", fieldWeights.payload ?? 0.5);
  }

  // ── 统计 ──────────────────────────────────

  get stats(): BM25Stats {
    return {
      docCount: this._docCount,
      avgDocLength: this._docCount > 0 ? this._totalTokens / this._docCount : 0,
      totalTerms: this._termDocFreq.size,
    };
  }

  get docCount(): number {
    return this._docCount;
  }

  // ── 文档操作 ──────────────────────────────

  /**
   * 添加或更新文档。
   * fields: { summary?, semantic_gist?, payload? }
   */
  addDocument(id: string, fields: Record<string, string>): void {
    // 先移除旧条目（如有）
    this.removeDocument(id);

    const fieldMap = new Map(Object.entries(fields));
    const fieldTokens = new Map<string, string[]>();
    const fieldTf = new Map<string, Map<string, number>>();
    let totalTokens = 0;

    for (const [fieldName, text] of fieldMap) {
      const tokens = tokenize(text);
      fieldTokens.set(fieldName, tokens);
      totalTokens += tokens.length;

      // M3 fix: 在索引时预计算 TF，避免搜索时重复计算
      const tfMap = new Map<string, number>();
      for (const t of tokens) {
        tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
      }
      fieldTf.set(fieldName, tfMap);

      // 更新倒排索引——同一文档内重复 token 只计一次 DF
      const seenTokens = new Set<string>();
      for (const t of tokens) {
        if (!seenTokens.has(t)) {
          seenTokens.add(t);
          this._termDocFreq.set(t, (this._termDocFreq.get(t) ?? 0) + 1);
        }
      }
    }

    this._docs.set(id, { id, fields: fieldMap, fieldTokens, fieldTf, totalTokens });
    this._totalTokens += totalTokens;
    this._docCount++;
  }

  /** 移除文档 */
  removeDocument(id: string): void {
    const doc = this._docs.get(id);
    if (!doc) return;

    // 清理 DF 计数
    for (const tokens of doc.fieldTokens.values()) {
      const seenTokens = new Set(tokens);
      for (const t of seenTokens) {
        const df = this._termDocFreq.get(t);
        if (df !== undefined) {
          if (df <= 1) {
            this._termDocFreq.delete(t);
          } else {
            this._termDocFreq.set(t, df - 1);
          }
        }
      }
    }

    this._totalTokens -= doc.totalTokens;
    this._docCount--;
    this._docs.delete(id);
  }

  // ── 搜索 ──────────────────────────────────

  /**
   * 搜索并返回 Top-N 结果。
   * @param query 查询文本
   * @param topN 返回数量（默认 20）
   * @returns 按 BM25 分降序的结果
   */
  search(query: string, topN = 20): BM25Result[] {
    if (!query || this._docCount === 0) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const avgDL = this._totalTokens / this._docCount;
    const k1 = this.k1;
    const b = this.b;

    // IDF 预计算
    const idfCache = new Map<string, number>();
    for (const t of queryTokens) {
      const df = this._termDocFreq.get(t) ?? 0;
      if (df > 0) {
        idfCache.set(t, Math.log(1 + (this._docCount - df + 0.5) / (df + 0.5)));
      }
    }

    // 逐文档评分
    const scores: BM25Result[] = [];

    for (const doc of this._docs.values()) {
      let totalScore = 0;

      for (const [fieldName, tokens] of doc.fieldTokens) {
        const fieldWeight = this.fieldWeights.get(fieldName) ?? 1;
        // M3 fix: 直接读取预计算的 TF，替代每次搜索动态计算
        const tfMap = doc.fieldTf.get(fieldName) ?? this._computeTF(tokens);
        if (!tfMap) continue;

        for (const qt of queryTokens) {
          const tf = tfMap.get(qt) ?? 0;
          if (tf === 0) continue;
          const idf = idfCache.get(qt) ?? 0;
          if (idf === 0) continue;

          const numerator = tf * (k1 + 1);
          const denominator = tf + k1 * (1 - b + b * (doc.totalTokens / avgDL));
          totalScore += idf * (numerator / denominator) * fieldWeight;
        }
      }

      if (totalScore > 0) {
        scores.push({ id: doc.id, score: totalScore });
      }
    }

    // 排序 → Top-N
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topN);
  }

  // ── 内部 ──────────────────────────────────

  /** 计算 token→tf 映射 */
  private _computeTF(tokens: string[]): Map<string, number> {
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }
    return tf;
  }
}
