// ============================================================
// context-builder.ts —— 上下文构建器
//
// ContextBuilder 按 ContextPolicy 驱动检索→排序→去重→分层组装→token 适配
// 将 MemoryStore 的多源检索结果转化为精简上下文注入 Agent。
//
// 六层管线：
//   ① 事实检索 — 按 RetrievalPolicy (HCA/CSA + BFS + 元数据过滤)
//   ② 评分排序 — 按 SortPolicy (confidence/recency/relevance/weighted)
//   ③ 噪声过滤 — 低于阈值的切掉
//   ④ 去重合并 — 多源同一事实合为一条
//   ⑤ 分层组装 — critical → support → reference 三层
//   ⑥ token 适配 — 预算内智能截断
//
// @since Cortex Core-2 — 上下文生命周期管理协议
// ============================================================

import type { ContextPolicy, MemoryEntry, MemoryQuery, ReadMode, TaskNode } from "@cortex/shared";
import type { MemoryStore } from "./memory-store.js";

// ─── 上下文构建结果 ──────────────────────────────────

export interface ContextBuildResult {
  /** 组装后的上下文文本 */
  readonly context: string;
  /** 总共检索到的记忆条数 */
  readonly totalRetrieved: number;
  /** 去重后保留条数 */
  readonly afterDedup: number;
  /** 最终注入上下文的条数 */
  readonly injected: number;
  /** 上下文字符串长度 */
  readonly charCount: number;
  /** 三层各自的条数 */
  readonly tierCounts: Record<string, number>;
}

// ─── 加权排序衰减 ────────────────────────────────────

function recencyDecay(lastAccessedAt: number, now: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) return 1;
  const age = now - lastAccessedAt;
  return Math.pow(2, -age / halfLifeMs);
}

// ─── 去重合并（摘要文本去重） ─────────────────────────

function deduplicateEntries(entries: MemoryEntry[]): MemoryEntry[] {
  const seen = new Set<string>();
  const result: MemoryEntry[] = [];
  // 按 weight 降序——先处理高分条目，同摘要的低分被去重
  const sorted = [...entries].sort((a, b) => b.weight - a.weight);
  for (const entry of sorted) {
    const key = entry.summary.slice(0, 100); // 前 100 字符做去重 key
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

// ─── ContextBuilder ───────────────────────────────────

export class ContextBuilder {
  constructor(private readonly memory: MemoryStore) {}

  /**
   * 按 ContextPolicy 构建上下文。
   *
   * @param policy  上下文管理策略（从 PRESET_CONTEXT_POLICIES 或自定义）
   * @param node    当前任务节点——payload 用于关键词提取
   * @returns       组装后的上下文文本 + 构建统计
   */
  async build(policy: ContextPolicy, node: TaskNode): Promise<ContextBuildResult> {
    const now = Date.now();
    const { retrieval, pipeline } = policy;

    // ── ① 事实检索 ──────────────────────────────
    const rawEntries = await this._retrieve(retrieval, node);

    // ── ② 评分排序 ──────────────────────────────
    const sorted = this._sort(rawEntries, pipeline.sort, now);

    // ── ③ 去重合并 ──────────────────────────────
    const deduped = pipeline.deduplicate ? deduplicateEntries(sorted) : sorted;

    // ── ④ 分层组装 ──────────────────────────────
    const { assembled, tierCounts } = this._assemble(deduped, pipeline.assemble, pipeline.tokenBudget.total);

    return {
      context: assembled,
      totalRetrieved: rawEntries.length,
      afterDedup: deduped.length,
      injected: Object.values(tierCounts).reduce((a, b) => a + b, 0),
      charCount: assembled.length,
      tierCounts,
    };
  }

  // ── 内部：检索 ──────────────────────────────

  private async _retrieve(retrieval: ContextPolicy["retrieval"], node: TaskNode): Promise<MemoryEntry[]> {
    const keywords = this._extractKeywords(node.payload);

    const query: MemoryQuery = {
      keywords,
      bfsDepth: retrieval.bfsDepth ?? 2,
      bfsMaxNodes: retrieval.bfsMaxNodes ?? 50,
      linkTypes: retrieval.linkTypes,
      metadataFilter: retrieval.metadataFilter,
      limit: 30,
    };

    const readMode: ReadMode = retrieval.readMode;
    return await this.memory.read(query, readMode);
  }

  // ── 内部：排序 ──────────────────────────────

  private _sort(
    entries: MemoryEntry[],
    sort: ContextPolicy["pipeline"]["sort"],
    now: number,
  ): MemoryEntry[] {
    const { mode, confidenceWeight = 0.5, halfLifeMs = 3_600_000 } = sort;
    const sorted = [...entries];

    switch (mode) {
      case "confidence":
        sorted.sort((a, b) => b.weight - a.weight);
        break;

      case "recency":
        sorted.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
        break;

      case "relevance":
        // 无向量分数时降级为 weight
        sorted.sort((a, b) => b.weight - a.weight);
        break;

      case "weighted": {
        const cw = confidenceWeight;
        const rw = 1 - cw;
        sorted.sort((a, b) => {
          const scoreA = cw * (a.weight / 10) + rw * recencyDecay(a.lastAccessedAt, now, halfLifeMs);
          const scoreB = cw * (b.weight / 10) + rw * recencyDecay(b.lastAccessedAt, now, halfLifeMs);
          return scoreB - scoreA;
        });
        break;
      }
    }

    return sorted;
  }

  // ── 内部：分层组装 ──────────────────────────

  /**
   * 三层组装：
   *   critical  — 前 N 条高优先级，不参与截断
   *   support   — 中段，token 不足时按权重截断
   *   reference — 末段，token 不足时首先被裁
   */
  private _assemble(
    entries: MemoryEntry[],
    assemble: ContextPolicy["pipeline"]["assemble"],
    totalBudget: number,
  ): { assembled: string; tierCounts: Record<string, number> } {
    const { tierBudget, maxTokensPerEntry = 300 } = assemble;
    const charBudget = totalBudget; // 用字符估算 token（≈1 token ≈ 4 chars，保守取 1:1 避免超限）

    const criticalCap = Math.floor(charBudget * tierBudget.critical);
    const supportCap = Math.floor(charBudget * tierBudget.support);
    const referenceCap = Math.floor(charBudget * tierBudget.reference);

    // critical: 前 N 条（weight 最高的）
    const criticalSlice: MemoryEntry[] = [];
    let criticalChars = 0;
    for (const e of entries) {
      const snippet = this._formatEntry(e, maxTokensPerEntry);
      if (criticalChars + snippet.length > criticalCap) break;
      criticalSlice.push(e);
      criticalChars += snippet.length;
    }

    // support: 余下条目（用 Set 替代 O(n²) Array.includes）
    const criticalSet = new Set(criticalSlice);
    const remaining = entries.filter((e) => !criticalSet.has(e));
    const supportSlice: MemoryEntry[] = [];
    let supportChars = 0;
    for (const e of remaining) {
      const snippet = this._formatEntry(e, maxTokensPerEntry);
      if (supportChars + snippet.length > supportCap) break;
      supportSlice.push(e);
      supportChars += snippet.length;
    }

    // reference: 再余下的（用 Set 替代 O(n²) Array.includes）
    const supportSet = new Set(supportSlice);
    const afterSupport = remaining.filter((e) => !supportSet.has(e));
    const referenceSlice: MemoryEntry[] = [];
    let referenceChars = 0;
    for (const e of afterSupport) {
      const snippet = this._formatEntry(e, maxTokensPerEntry);
      if (referenceChars + snippet.length > referenceCap) break;
      referenceSlice.push(e);
      referenceChars += snippet.length;
    }

    // 组装
    const parts: string[] = [];
    if (criticalSlice.length > 0) {
      parts.push("## 关键上下文\n" + criticalSlice.map((e) => this._formatEntry(e, maxTokensPerEntry)).join("\n"));
    }
    if (supportSlice.length > 0) {
      parts.push("## 支撑材料\n" + supportSlice.map((e) => this._formatEntry(e, maxTokensPerEntry)).join("\n"));
    }
    if (referenceSlice.length > 0) {
      parts.push("## 参考附录\n" + referenceSlice.map((e) => this._formatEntry(e, maxTokensPerEntry)).join("\n"));
    }

    return {
      assembled: parts.join("\n\n"),
      tierCounts: {
        critical: criticalSlice.length,
        support: supportSlice.length,
        reference: referenceSlice.length,
      },
    };
  }

  // ── 内部：格式化单条记忆 ─────────────────────

  private _formatEntry(entry: MemoryEntry, maxChars: number): string {
    const summary = entry.summary.length > maxChars
      ? entry.summary.slice(0, maxChars) + "…"
      : entry.summary;
    return `- [w:${entry.weight}] ${summary}`;
  }

  // ── 内部：关键词提取 ────────────────────────

  private _extractKeywords(payload: string): string[] {
    const keywords: string[] = [];

    // CJK 2-gram
    const cjkChars = payload.replace(/[^一-鿿㐀-䶿]/g, "");
    for (let i = 0; i <= cjkChars.length - 2; i++) {
      keywords.push(cjkChars.slice(i, i + 2));
    }

    // 拉丁词
    const latinWords = payload.split(/\s+/).filter((w) => w.length > 3);
    keywords.push(...latinWords);

    return keywords;
  }
}
