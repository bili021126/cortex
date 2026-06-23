// ============================================================
// @cortex/engine/memory/memory-store —— MemoryStore 适配器
//
// @layer 适配器 — 委托 @cortex/memory 后端，引擎层仅挂载 embedding + 权重老化 + maintain。
// @since v3.0.0 — 存储核心已迁至 @cortex/memory，本适配器桥接引擎层能力。
// ============================================================

import {
  PipelineEventType,
  PipelinePriority,
  LifecyclePhase,
  type ILifecycle,
  type IPipelineObserver,
  type IMemoryStore,
  type MaintainReport,
  type MemoryEntry,
  type MemoryLink,
  type MemoryQuery,
  type MemoryWriteInput,
  type ReadMode,
  type LinkType,
  type SemanticState,
  MEMORY_VALID_TRANSITIONS,
} from "@cortex/shared";
import * as crypto from "node:crypto";
import { InMemoryMemoryStore, type TransactionalMemoryStore } from "@cortex/memory";
import {
  SCHEMA_VERSION,
  EMBEDDING_DIM,
  CONTENT_HASH_ALGO,
  VECTOR_DEDUP_THRESHOLD,
  WEIGHT_AGING_FACTOR,
  MAX_TOTAL_MEMORIES,
  STALE_FREEZE_DAYS,
  FROZEN_OBLITERATE_DAYS,
  MAINTENANCE_WEIGHT_THRESHOLD,
} from "./schema.js";

// ── 状态转换常量（由 FSM 编译器定义驱动） ──

/** 30 天 TTL 毫秒 */
const MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** MEMORY_VALID_TRANSITIONS 来自 @cortex/shared —— 单一事实来源 */
const VALID_TRANSITIONS = MEMORY_VALID_TRANSITIONS;
import { defaultEmbeddingService, type IEmbeddingService } from "./embedding.js";
import { BM25Index } from "./bm25-index.js";
import { HybridRetriever, type HybridRetrievalConfig } from "./hybrid-retrieval.js";

/**
 * MemoryStore —— 适配器（委托 @cortex/memory TransactionalMemoryStore 后端）。
 *
 * @implements IMemoryStore — 记忆存储接口
 * @implements ILifecycle — 标准组件生命周期
 * @depends @cortex/memory（存储核心 — InMemoryMemoryStore / FileBasedMemoryStore）
 * @depends memory/embedding.ts（语义嵌入 — 384d ONNX）
 * @depends @cortex/shared（IMemoryStore 接口 + 类型定义）
 *
 * @dataflow
 *   write(input) → 嵌入生成 → SHA256 去重 → backend.write()
 *   read(query)  → 自动 query embedding → backend.read() → 权重老化
 *   maintain()  → 扫描 backend → archive/obliterate
 */
export class MemoryStore implements IMemoryStore, ILifecycle {
  /** 公开 schema 版本常量，供外部校验 */
  static readonly SCHEMA_VERSION = SCHEMA_VERSION;

  private readonly _backend: TransactionalMemoryStore;
  private _observer?: IPipelineObserver;
  private readonly _embedder: IEmbeddingService;
  private _preWriteHook?: (input: MemoryWriteInput) => MemoryWriteInput;
  private _closed = false;
  private _phase: LifecyclePhase = LifecyclePhase.Created;
  private readonly _bm25Index = new BM25Index();
  private readonly _hybridRetriever: HybridRetriever;
  private _hybridEnabled = true;
  /** 归档失败熔断：true 时拒绝新写入，防止内存无界增长 */
  private _overflowThrottled = false;

  constructor(
    backend?: TransactionalMemoryStore,
    observer?: IPipelineObserver,
    embedder?: IEmbeddingService,
    hybridConfig?: Partial<HybridRetrievalConfig>,
  ) {
    this._backend = backend ?? new InMemoryMemoryStore();
    this._observer = observer;
    this._embedder = embedder ?? defaultEmbeddingService;
    this._hybridRetriever = new HybridRetriever(hybridConfig);
  }

  // ══════════════════════════════════════════════
  // ILifecycle 实现
  // ══════════════════════════════════════════════

  get phase(): LifecyclePhase {
    return this._phase;
  }

  // Method overload: ILifecycle.init() + IMemoryStore.init(dbPath)
  async init(): Promise<void>;
  async init(dbPath: string): Promise<void>;
  async init(dbPath?: string): Promise<void> {
    if (dbPath !== undefined) {
      // IMemoryStore 路径：初始化后端
      await this._backend.init(dbPath);
      this._phase = LifecyclePhase.Running;
      return;
    }
    // ILifecycle 路径
    if (this._phase !== LifecyclePhase.Created) {
      throw new Error(`[MemoryStore] 无法 init: 当前 phase=${this._phase}，期望 Created`);
    }
    this._phase = LifecyclePhase.Running;
  }

  async start(): Promise<void> {
    if (this._phase !== LifecyclePhase.Running) return;
    // MemoryStore 无额外启动逻辑
  }

  async stop(): Promise<void> {
    if (this._phase !== LifecyclePhase.Running) return;
    this._phase = LifecyclePhase.Stopping;
    try {
      await this._backend.flush();
    } catch (err) {
      this._emitDegraded("stop-flush", `flush 失败（不阻塞关闭）: ${String(err)}`);
    }
    this._phase = LifecyclePhase.Stopped;
  }

  async dispose(): Promise<void> {
    if (this._phase === LifecyclePhase.Disposed) return;
    if (!this._closed) {
      this._closed = true;
      try {
        await this._backend.close();
      } catch (err) {
        this._emitDegraded("dispose-close", `后端关闭失败: ${String(err)}`);
      }
    }
    this._observer = undefined;
    this._phase = LifecyclePhase.Disposed;
  }

  // ══════════════════════════════════════════════
  // 属性委托
  // ══════════════════════════════════════════════

  get isPersisted(): boolean {
    return this._backend.isPersisted;
  }

  get size(): number {
    return this._backend.size;
  }

  get sessionId(): string | undefined {
    return this._backend.sessionId;
  }

  // ══════════════════════════════════════════════
  // 生命周期（直通后端）
  // ══════════════════════════════════════════════

  beginSession(externalId?: string): string {
    return this._backend.beginSession(externalId);
  }

  async endSession(): Promise<number> {
    return await this._backend.endSession();
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    await this._backend.close();
    this._observer = undefined;
  }

  async flush(): Promise<void> {
    await this._backend.flush();
  }

  // ══════════════════════════════════════════════
  // 写入（嵌入生成 + 去重 → 后端写入）
  // ══════════════════════════════════════════════

  /**
   * 写入一条记忆（嵌入生成 + SHA256 去重 → 后端写入）。
   *
   * 异常路径：嵌入失败静默降级（不阻塞写入）。
   */
  async write(input: MemoryWriteInput): Promise<string> {
    if (this._closed) throw new Error("MemoryStore 已关闭，拒绝写入");
    if (this._phase !== LifecyclePhase.Running) {
      throw new Error(`[MemoryStore] 拒绝写入: 当前 phase=${this._phase}，仅 Running 状态可写入`);
    }
    if (this._overflowThrottled) throw new Error("MemoryStore 写入熔断：auto-archive 失败，调用 maintain() 清理后恢复");
    input = this._validateWrite(input);

    // ── 嵌入生成（静默降级：失败不阻塞写入）──
    if (input.embedding === undefined) {
      try {
        const text = input.semantic_gist || JSON.stringify(input.content_blob).slice(0, 2000);
        input.embedding = await this._embedder.embedText(text);
      } catch {
        this._emitDegraded("embedding", "embedding 生成失败，已降级跳过");
      }
    }

    if (input.embedding !== undefined && input.embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedding 维度不匹配: 期望 ${EMBEDDING_DIM}，实际 ${input.embedding.length}`,
      );
    }

    // ── SHA256 内容去重 ──
    const contentHash = crypto
      .createHash(CONTENT_HASH_ALGO)
      .update(input.summary + JSON.stringify(input.content_blob))
      .digest("hex");

    const dup = await this._tryDedup(contentHash);
    if (dup) return dup;

    input.content_hash = contentHash;

    // ── 后端写入 ──
    const id = await this._backend.write(input);

    // ── BM25 索引更新 ──
    if (this._hybridEnabled) {
      this._bm25Index.addDocument(id, {
        summary: input.summary ?? "",
        semantic_gist: input.semantic_gist ?? "",
        payload: typeof input.content_blob === "string" ? input.content_blob : JSON.stringify(input.content_blob),
      });
    }

    // ── 向量相似去重（后验：写入后扫描）──
    if (input.embedding) {
      await this._tryVectorDedup(id, input.embedding);
    }

    // ── 总量上限：超出时归档最久未访问的记忆 ──
    await this._autoArchiveIfOverflow();

    return id;
  }

  // ══════════════════════════════════════════════
  // 读取（后端查询 + 权重老化）
  // ══════════════════════════════════════════════

  /**
   * 读取记忆（后端查询 + 权重老化）。
   */
  async read(query: MemoryQuery, mode: ReadMode = "CSA"): Promise<MemoryEntry[]> {
    if (this._closed) throw new Error("MemoryStore 已关闭，拒绝读取");
    // ── 自动生成 query embedding（若未提供且有 keywords）──
    if (!query.queryEmbedding && query.keywords && query.keywords.length > 0) {
      try {
        query.queryEmbedding = await this._embedder.embedText(query.keywords.join(" "));
      } catch {
        this._emitDegraded("query-embedding", "查询向量生成失败，降级跳过向量检索");
      }
    }

    const resolvedLimit = query.limit ?? (mode === "HCA" ? 10 : 3);

    // ── 传递 keywords 到后端：后端在 summary/semantic_gist 层过滤，适配器补充 content_blob 搜索 ──
    const backendQuery = { ...query };
    let results = await this._backend.read(backendQuery, mode);

    // ── 适配器层过滤：30 天 TTL ──
    const now = Date.now();
    results = results.filter(
      (m: MemoryEntry) => (now - m.createdAt) <= MEMORY_TTL_MS,
    );

    // ── 适配器层过滤：content_blob 关键词匹配 ──
    if (query.keywords && query.keywords.length > 0) {
      const lowerKeywords = query.keywords.map((k) => k.toLowerCase());
      results = results.filter((entry: MemoryEntry) => {
        // 先检查 summary / semantic_gist（后端已过滤，此处为安全网）
        const summary = (entry.summary ?? "").toLowerCase();
        const gist = (entry.semantic_gist ?? "").toLowerCase();
        const inText = lowerKeywords.some(
          (kw) => summary.includes(kw) || gist.includes(kw),
        );
        if (inText) return true;

        // 额外检查 content_blob JSON 字段
        const blob = entry.content_blob;
        if (blob && typeof blob === "object") {
          const blobStr = JSON.stringify(blob).toLowerCase();
          return lowerKeywords.some((kw) => blobStr.includes(kw));
        }
        return false;
      });
    }

    // ── 混合检索增强（BM25 + 向量融合 + 贪心精排）──
    if (this._hybridEnabled && query.queryEmbedding && results.length > 0) {
      try {
        // ① BM25 文本检索
        const queryText = query.keywords?.join(" ") ?? "";
        const bm25Results = this._bm25Index.search(queryText, results.length * 2);
        const bm25Map = new Map(bm25Results.map((r) => [r.id, r.score]));

        // ② 混合评分
        const scored = await this._hybridRetriever.score(results, bm25Map, query.queryEmbedding, this._embedder);

        // ③ 贪心精排 + 边界回归裁切
        const fineRanked = this._hybridRetriever.greedyFineRank(scored);

        // ④ 将 hybridScore 注入 weight 字段（类似分值语义）
        results = fineRanked.map((r) => ({ ...r.entry, weight: r.hybridScore * 10 }));
      } catch {
        this._emitDegraded("hybrid-retrieval", "混合检索失败，降级使用原始结果");
      }
    }

    // ── 权重自然老化：每 7 天未访问衰减 5% ──
    results = results.map((m: MemoryEntry) => {
      // 如果是混合检索已赋值的高分，跳过老化
      const daysSinceAccess = (now - m.lastAccessedAt) / 24 / 60 / 60 / 1000;
      if (daysSinceAccess > 0) {
        const aged = m.weight * Math.pow(WEIGHT_AGING_FACTOR, daysSinceAccess / 7);
        if (Math.abs(aged - m.weight) > 0.0001) {
          return { ...m, weight: aged };
        }
      }
      return m;
    });

    // 按 weight 降序排列
    results.sort((a: MemoryEntry, b: MemoryEntry) => b.weight - a.weight);

    // 截取
    if (resolvedLimit > 0) {
      results = results.slice(0, resolvedLimit);
    }

    return results;
  }

  // ══════════════════════════════════════════════
  // 写入与状态（直通后端）
  // ══════════════════════════════════════════════

  link(sourceId: string, targetId: string, linkType: LinkType): MemoryLink | null {
    // ── 源/目标湮灭态拒绝 ──
    const source = this._backend.peek(sourceId);
    if (!source || source.semantic_state === "Obliterated") {
      return null;
    }
    const target = this._backend.peek(targetId);
    if (!target || target.semantic_state === "Obliterated") {
      return null;
    }

    // ── 幂等去重 ──
    const existing = this._backend.getLinks(sourceId);
    const dup = existing.find(
      (l) => l.targetId === targetId && l.linkType === linkType,
    );
    if (dup) return null;

    return this._backend.link(sourceId, targetId, linkType);
  }

  getLinks(sourceId: string): MemoryLink[] {
    return this._backend.getLinks(sourceId);
  }

  has(memoryId: string): boolean {
    return this._backend.has(memoryId);
  }

  peek(memoryId: string): Readonly<MemoryEntry> | undefined {
    return this._backend.peek(memoryId);
  }

  /**
   * CAS (Compare-And-Swap) 状态转换。
   * 后端为纯内存操作（单线程 JS EventLoop 保证原子性），无 persistFn 回滚风险。
   * @see FIND-002 — 已核实为误报（不存在 persistFn 异常回滚路径）
   */
  cas(memoryId: string, expected: SemanticState, newState: SemanticState): boolean {
    const validTargets = VALID_TRANSITIONS[expected];
    if (!validTargets?.has(newState)) {
      this._emitDegraded("cas", `CAS拒绝: ${memoryId} ${expected}→${newState}（非法转换）`);
      return false;
    }

    const result = this._backend.cas(memoryId, expected, newState);
    if (!result) {
      this._emitDegraded("cas", `CAS失败: ${memoryId} ${expected}→${newState}`);
    }
    return result;
  }

  archive(memoryId: string): boolean {
    return this._backend.archive(memoryId);
  }

  /** freeze → archive 映射（后端无 Frozen 中间态）
   * 已 Archived 的条目再次 freeze 幂等返回 true */
  freeze(memoryId: string): boolean {
    const entry = this._backend.peek(memoryId);
    if (!entry) return false;
    // 已 Obliterated 不可 freeze
    if (entry.semantic_state === "Obliterated") return false;
    // 已 Archived 幂等
    if (entry.semantic_state === "Archived") return true;
    return this._backend.archive(memoryId);
  }

  obliterate(memoryId: string): boolean {
    // ── BM25 索引同步移除 ──
    if (this._hybridEnabled) {
      this._bm25Index.removeDocument(memoryId);
    }
    return this._backend.obliterate(memoryId);
  }

  /** 异步 enrichment：两阶段提交的记忆补全 embedding + dedup + BM25 */
  private async _enrichPendingEntry(memoryId: string): Promise<void> {
    try {
      const entry = await this._backend.peek(memoryId);
      if (!entry) return;

      // embedding 生成（不修改只读 entry——仅缓存）
      if (!entry.embedding) {
        const text = entry.semantic_gist || JSON.stringify(entry.content_blob).slice(0, 2000);
        try {
          const emb = await this._embedder.embedText(text);
          if (emb && emb.length === EMBEDDING_DIM) {
            this._vectorCache.set(entry.id, emb);
          }
        } catch {
          this._emitDegraded("embedding", "commitMemory embedding 失败");
        }
      } else {
        this._vectorCache.set(entry.id, entry.embedding);
      }

      // content_hash 去重缓存
      if (entry.content_hash) {
        this._dedupCache.set(entry.content_hash, entry.id);
      }

      // 向量索引缓存
      if (entry.embedding) {
        this._vectorCache.set(entry.id, entry.embedding);
      }

      // BM25 索引更新
      if (this._hybridEnabled) {
        this._bm25Index.addDocument(entry.id, {
          summary: entry.summary ?? "",
          semantic_gist: entry.semantic_gist ?? "",
          payload: typeof entry.content_blob === "string" ? entry.content_blob : JSON.stringify(entry.content_blob),
        });
      }
    } catch {
      // enrichment 失败不阻塞主流程
    }
  }

  // ══════════════════════════════════════════════
  // 两阶段提交（直通后端）
  // ══════════════════════════════════════════════

  writePending(input: MemoryWriteInput): string {
    input = this._validateWrite(input);
    return this._backend.writePending(input);
  }

  commitMemory(memoryId: string): boolean {
    const ok = this._backend.commitMemory(memoryId);
    if (ok) {
      // 异步 enrichment：embedding 生成 + dedup 缓存 + BM25 索引更新
      // M-05 修复：加 .catch() 取代 fire-and-forget，失败时输出错误
      this._enrichPendingEntry(memoryId).catch((err) => {
        process.stderr.write(`[MemoryStore] commitMemory enrichment 失败: ${String(err)}\n`);
      });
    }
    return ok;
  }

  async rollback(memoryId: string): Promise<boolean> {
    try {
      return await this._backend.rollback(memoryId);
    } catch {
      return false;
    }
  }

  cancel(memoryId: string): boolean {
    return this._backend.cancel(memoryId);
  }

  getPending(): MemoryEntry[] {
    return this._backend.getPending();
  }

  hasPending(): boolean {
    return this._backend.hasPending();
  }

  getBySession(sessionId: string): MemoryEntry[] {
    return this._backend.getBySession(sessionId);
  }

  // ══════════════════════════════════════════════
  // 维护
  // ══════════════════════════════════════════════

  /**
   * 主动维护：归档过期低权重 Active 记忆 → 湮灭长期 Archived 记忆。
   */
  maintain(): MaintainReport {
    const now = Date.now();
    const freezeThreshold = now - STALE_FREEZE_DAYS * 24 * 60 * 60 * 1000;
    const obliterateThreshold = now - FROZEN_OBLITERATE_DAYS * 24 * 60 * 60 * 1000;

    let archived = 0;
    let obliterated = 0;

    // 通过无过滤 getAllEntries 获取全量条目
    try {
      // 后端 getAllEntries() 为同步 Map 操作，maintain() 同步签名安全调用
      const all = this._syncReadAll();
      if (!all) return { archived: 0, obliterated: 0, orphanedLinks: 0 };

      // Phase 1: 归档过期低权重 Active 记忆
      for (const m of all) {
        if (m.semantic_state !== "Active") continue;
        if (m.lastAccessedAt > freezeThreshold) continue;
        if (m.weight >= MAINTENANCE_WEIGHT_THRESHOLD) continue;
        const ok = this._backend.archive(m.id);
        if (ok) archived++;
      }

      // Phase 2: 湮灭长期 Archived 记忆
      for (const m of all) {
        if (m.semantic_state !== "Archived") continue;
        // 修正 C-07：此前条件为 recent && no_expiry → continue，导致 Archived 堆积无限增长
        // 正确逻辑：近期被访问过的不湮灭，其余全部湮灭
        if (m.lastAccessedAt > obliterateThreshold) continue;
        const ok = this._backend.obliterate(m.id);
        if (ok) obliterated++;
      }
    } catch {
      this._emitDegraded("maintain", "维护扫描失败，静默降级");
    }

    // 维护成功后重置熔断，恢复写入
    if (this._overflowThrottled) {
      this._overflowThrottled = false;
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemorySqlDegraded,
          priority: PipelinePriority.NORMAL,
          payload: {
            operation: "throttle-reset",
            detail: `写入熔断已重置，current size=${this._backend.size}，上限=${MAX_TOTAL_MEMORIES}`,
          },
          timestamp: Date.now(),
          notificationType: "FYI",
        });
      }
    }

    return { archived, obliterated, orphanedLinks: 0 };
  }

  // 同步读取全量（适配 maintain 的同步签名）
  private _syncReadAll(): MemoryEntry[] | null {
    try {
      // 后端 getAllEntries() 为同步 Map 操作，安全用于 maintain 同步路径
      return this._backend.getAllEntries();
    } catch {
      this._emitDegraded("syncReadAll", "全量同步读取失败");
      return null;
    }
  }

  // ══════════════════════════════════════════════
  // 钩子
  // ══════════════════════════════════════════════

  setPreWriteHook(hook: (input: MemoryWriteInput) => MemoryWriteInput): void {
    this._backend.setPreWriteHook(hook);
    this._preWriteHook = hook;
  }

  // ══════════════════════════════════════════════
  // 私有方法
  // ══════════════════════════════════════════════

  private _validateWrite(input: MemoryWriteInput): MemoryWriteInput {
    if (this._preWriteHook) {
      input = this._preWriteHook(input);
    }
    if (input.embedding !== undefined && input.embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedding 维度不匹配: 期望 ${EMBEDDING_DIM}，实际 ${input.embedding.length}`,
      );
    }
    return input;
  }

  private _emitDegraded(operation: string, detail: string): void {
    if (!this._observer) return;
    this._observer.emit({
      type: PipelineEventType.MemorySqlDegraded,
      priority: PipelinePriority.NORMAL,
      payload: { operation, detail },
      timestamp: Date.now(),
    });
  }

  /** SHA256 去重缓存：content_hash → id */
  private readonly _dedupCache = new Map<string, string>();
  /** 向量索引缓存：id → embedding，用于快速向量去重 */
  private readonly _vectorCache = new Map<string, number[]>();

  /** SHA256 去重——优先查缓存，miss 时全表扫描 */
  private async _tryDedup(contentHash: string): Promise<string | null> {
    // 缓存命中
    const cached = this._dedupCache.get(contentHash);
    if (cached) return cached;

    try {
      const all = await this._backend.read({}, "HCA");
      const dup = all.find((e: MemoryEntry) => e.content_hash === contentHash);
      if (dup) {
        this._dedupCache.set(contentHash, dup.id);
        return dup.id;
      }
      // 缓存未命中：预热缓存（O(n) 一次，后续 O(1)）
      for (const e of all) {
        if (e.content_hash) this._dedupCache.set(e.content_hash, e.id);
        if (e.embedding) this._vectorCache.set(e.id, e.embedding);
      }
      return null;
    } catch {
      this._emitDegraded("dedup-content-hash", "SHA256去重扫描失败");
      return null;
    }
  }

  /** 向量相似去重——每次查询前刷新缓存，避免过期数据 */
  private async _tryVectorDedup(newId: string, embedding: number[]): Promise<void> {
    try {
      // M-06 修复：每次查询前从后端刷新 _vectorCache，避免过期缓存漏去重
      const all = await this._backend.read({}, "HCA");
      for (const e of all) {
        if (e.embedding) this._vectorCache.set(e.id, e.embedding);
      }
      const candidates = Array.from(this._vectorCache.entries());
      for (const [id, emb] of candidates) {
        if (id === newId || emb?.length !== embedding.length) continue;
        const dot = embedding.reduce((sum: number, v: number, i: number) => sum + v * (emb[i] ?? 0), 0);
        const magA = Math.sqrt(embedding.reduce((s: number, v: number) => s + v * v, 0));
        const magB = Math.sqrt(emb.reduce((s: number, v: number) => s + v * v, 0));
        const cos = magA > 0 && magB > 0 ? dot / (magA * magB) : 0;
        if (cos >= VECTOR_DEDUP_THRESHOLD) {
          await this._backend.delete(newId);
          return;
        }
      }
    } catch {
      this._emitDegraded("vector-dedup", "向量去重扫描失败，静默降级");
    }
  }

  /** 总量超限时自动归档最久未访问的 Active 记忆 */
  private async _autoArchiveIfOverflow(): Promise<void> {
    if (this._overflowThrottled) return;
    const totalSize = this._backend.size;
    if (totalSize <= MAX_TOTAL_MEMORIES) return;

    try {
      const all = await this._backend.read({}, "HCA");
      const activeEntries = all
        .filter((e: MemoryEntry) => e.semantic_state === "Active")
        .sort((a: MemoryEntry, b: MemoryEntry) => a.lastAccessedAt - b.lastAccessedAt);

      // H-03 修复：用总量计 excess，非 Active 数
      const excess = totalSize - MAX_TOTAL_MEMORIES;
      if (excess <= 0) return;

      const toArchive = activeEntries.slice(0, Math.min(excess, activeEntries.length));
      for (const e of toArchive) {
        this._backend.archive(e.id);
      }

      if (toArchive.length > 0 && this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemorySqlDegraded,
          priority: PipelinePriority.NORMAL,
          payload: {
            operation: "auto-archive",
            detail: `已自动归档 ${toArchive.length} 条最久未访问记忆（总量超 ${MAX_TOTAL_MEMORIES} 上限）`,
          },
          timestamp: Date.now(),
          notificationType: "FYI",
        });
      }
    } catch {
      // 归档失败 → 熔断开路，阻止新写入防止内存无限增长
      this._overflowThrottled = true;
      this._emitDegraded(
        "auto-archive",
        `自动归档失败，已触发写入熔断（当前 size=${this._backend.size}，上限=${MAX_TOTAL_MEMORIES}）。调用 maintain() 恢复。`,
      );
    }
  }
}
