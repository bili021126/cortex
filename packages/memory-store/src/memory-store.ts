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
const MEMORY_TTL_MS = STALE_FREEZE_DAYS * 24 * 60 * 60 * 1000;

import { defaultEmbeddingService, type IEmbeddingService } from "./embedding.js";
import {
  stateTransitionToEvent,
} from "./memory-state-machine.js";
import { BM25Index } from "./bm25-index.js";
import { DedupService } from "./dedup-service.js";
import { WeightAger } from "./weight-ager.js";
import { HybridRetriever, type HybridRetrievalConfig } from "./hybrid-retrieval.js";
// 原则五（统一可观测）：热路径指标走正式遥测通道，禁止裸 console
import { recordTelemetry } from "@cortex/telemetry";

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
  private readonly _dedupService = new DedupService();
  private readonly _ager = new WeightAger();
  private readonly _hybridRetriever: HybridRetriever;
  private _hybridEnabled = true;
  /** 归档失败熔断：true 时拒绝新写入，防止内存无界增长 */
  private _overflowThrottled = false;
  /** inflight 去重：contentHash → writePromise，防 TOCTOU 竞态 */
  private _inflightWrites = new Map<string, Promise<string>>();
  /** 标记删除集：maintain() 标记，read() 过滤，避免并发读写不一致 */
  private _pendingObliterate = new Set<string>();

  /** 权重老化写回失败 → observer 发射 + stderr fallback，永不抛异常 */
  private _safeAgingError(err: unknown, entryId: string, phase: "set" | "write"): void {
    const msg = `[memory-store] weight aging ${phase} failed for ${entryId}: ${err instanceof Error ? err.message : String(err)}`;
    if (this._observer) {
      this._observer.emit({
        type: PipelineEventType.ErrorReported,
        priority: PipelinePriority.NORMAL,
        payload: {
          source: `memory-store.weightAging.${phase}`,
          severity: "degraded",
          error: msg,
        },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    } else if (typeof process !== "undefined") {
      process.stderr.write(msg + "\n");
    }
  }

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
    // ILifecycle 路径——idempotent，已 Running 则跳过
    if (this._phase === LifecyclePhase.Running) return;
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

    const dup = this._tryDedup(contentHash);
    if (dup) return dup;

    input.content_hash = contentHash;

    // ── TOCTOU 防御：二次检查（_tryDedup 与 backend.write 间的竞态窗口）──
    const dupCheck = this._dedupCache.get(contentHash);
    if (dupCheck) return dupCheck;

    // ── inflight 去重（防 TOCTOU 竞态）──
    const inflight = this._inflightWrites.get(contentHash);
    if (inflight) return await inflight;

    // ── 后端写入 + inflight 注册 ──
    const writePromise = (async (): Promise<string> => {
      const id = await this._backend.write(input);
      this._dedupCacheSet(contentHash, id); // 写入成功立即缓存
      return id;
    })();
    this._inflightWrites.set(contentHash, writePromise);
    let id: string;
    try {
      id = await writePromise;
    } finally {
      this._inflightWrites.delete(contentHash);
    }

    // ── 向量相似去重（后验：写入后扫描）──
    // C8/H4 fix: 必须在 observer emit / BM25 索引之前执行，
    // 避免去重删除条目后下游持有悬空 ID 引用。
    let finalId = id;
    if (input.embedding) {
      const vectorDupId = await this._tryVectorDedup(id, input.embedding, contentHash);
      if (vectorDupId !== null) {
        finalId = vectorDupId; // R1 fix: 返回已存在的相似条目 ID
      }
    }

    // ── 总量上限：超出时归档最久未访问的记忆（在去重之后）──
    await this._autoArchiveIfOverflow();
    if (this._observer) {
      const blobStr = typeof input.content_blob === "string" ? input.content_blob : JSON.stringify(input.content_blob);
      this._observer.emit({
        type: PipelineEventType.MemMemoryWritten,
        priority: PipelinePriority.NORMAL,
        payload: {
          entryId: finalId,
          domain: input.domain,
          scene: input.kind,
          byteSize: new TextEncoder().encode(blobStr).length,
        },
        timestamp: Date.now(),
        notificationType: "FYI",
      });
    }

    // ── BM25 索引更新 ──
    if (this._hybridEnabled) {
      this._bm25Index.addDocument(finalId, {
        summary: input.summary ?? "",
        semantic_gist: input.semantic_gist ?? "",
        payload: typeof input.content_blob === "string" ? input.content_blob : JSON.stringify(input.content_blob),
      });
    }

    return finalId;
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
    // P1-A fix: 放大后端查询 limit 确保适配器层过滤后仍能返回 resolvedLimit 条
    // （后端先按 weight 排序裁切，适配器再补 TTL/标记删除/关键词过滤 → 先裁后滤欠取）
    // 注意 hybrid 分支有自己的排序裁切，不干扰此路径
    backendQuery.limit = Math.max(backendQuery.limit ?? 0, resolvedLimit * 3);
    // ── 遥测：Memory 检索耗时 ──
    const t0 = Date.now();
    let results = await this._backend.read(backendQuery, mode);
    void recordTelemetry("memory.search_time_ms", Date.now() - t0, [{ key: "mode", value: mode }]).catch(() => {});

    // ── 适配器层过滤：30 天 TTL + 标记删除 ──
    const now = Date.now();
    results = results.filter(
      (m: MemoryEntry) => (now - m.createdAt) <= MEMORY_TTL_MS && !this._pendingObliterate.has(m.id),
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

    // ── 捕获后端原始 weight：混合检索会把 weight 覆写为 relevance 分，
    //     而权重老化的持久化回写必须基于原始存储值，不能基于易失的 relevance 分（T3）──
    const originalWeights = new Map<string, number>(results.map((m) => [m.id, m.weight]));
    let hybridApplied = false;
    
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
        hybridApplied = true;
      } catch {
        this._emitDegraded("hybrid-retrieval", "混合检索失败，降级使用原始结果");
      }
    }

    // ── 权重自然老化（排序用）：每 7 天未访问衰减 5% ──
    //     混合检索已赋 relevance 分（hybridScore*10），排序不参与老化；
    //     持久化回写在截取后单独进行（基于原始 weight，避免二次老化）(T3)
    if (!hybridApplied) {
      results = results.map((m: MemoryEntry) => {
        const daysSinceAccess = (now - m.lastAccessedAt) / 24 / 60 / 60 / 1000;
        if (daysSinceAccess > 0) {
          const aged = m.weight * Math.pow(WEIGHT_AGING_FACTOR, daysSinceAccess / 7);
          if (Math.abs(aged - m.weight) > 0.0001) {
            return { ...m, weight: aged };
          }
        }
        return m;
      });
    }

    // 按 weight 降序排列
    results.sort((a: MemoryEntry, b: MemoryEntry) => b.weight - a.weight);

    // 截取
    if (resolvedLimit > 0) {
      results = results.slice(0, resolvedLimit);
    }

    // ── 异步回写老化 weight——基于后端原始 weight 派生（不使用排序/relevance 覆写值），
    //     仅对截取后返回的条目回写，避免二次老化与 relevance 分污染持久层 (T3)──
    for (const entry of results) {
      const origWeight = originalWeights.get(entry.id) ?? entry.weight;
      const daysSinceAccess = (now - entry.lastAccessedAt) / 24 / 60 / 60 / 1000;
      if (daysSinceAccess > 0) {
        const agedWeight = origWeight * Math.pow(WEIGHT_AGING_FACTOR, daysSinceAccess / 7);
        if (Math.abs(agedWeight - origWeight) > 0.1) {
          try {
            // 读-改-写：set() 是整体替换语义，必须传完整条目、仅更新 weight，
            // 否则会把其他字段（content/embedding/时间戳）抹掉造成数据丢失。
            const updated: MemoryEntry = { ...entry, weight: agedWeight };
            const setPromise = this._backend.set(entry.id, updated);
            if (setPromise) setPromise.catch((e) => this._safeAgingError(e, entry.id, "set"));
          } catch (_e) {
            // best-effort：老化回写属非关键路径，失败仅记录（write 会新建条目而非更新，不适用）
            this._safeAgingError(_e, entry.id, "set");
          }
        }
      }
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
    // 自引用幂等：实际状态与预期一致时才放行
    if (expected === newState) {
      const entry = this._backend.peek(memoryId);
      if (entry?.semantic_state === expected) return true;
    }

    // 使用 FSM 定义替代静态白名单（结构校验，不评估 guard）
    const event = stateTransitionToEvent(expected.toLowerCase(), newState.toLowerCase());
    if (!event) {
      this._emitDegraded("cas", `CAS拒绝: ${memoryId} ${expected}→${newState}（无效转换）`);
      return false;
    }

    const result = this._backend.cas(memoryId, expected, newState);
    if (!result) {
      this._emitDegraded("cas", `CAS失败: ${memoryId} ${expected}→${newState}`);
    }
    return result;
  }

  archive(memoryId: string): boolean {
    this._bm25Index?.removeDocument(memoryId);
    this._evictCaches(memoryId);
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
    this._evictCaches(memoryId);
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
          if (emb?.length === EMBEDDING_DIM) {
            this._vectorCacheSet(entry.id, emb);
          }
        } catch {
          this._emitDegraded("embedding", "commitMemory embedding 失败");
        }
      } else {
        this._vectorCacheSet(entry.id, entry.embedding);
      }

      // content_hash 去重缓存
      // R4-H1 fix: 两阶段提交路径 content_hash 可能为空——在此补算
      if (entry.content_hash) {
        this._dedupCacheSet(entry.content_hash, entry.id);
      } else {
        const ch = crypto
          .createHash(CONTENT_HASH_ALGO)
          .update(entry.summary + JSON.stringify(entry.content_blob))
          .digest("hex");
        this._dedupCacheSet(ch, entry.id);
      }

      // 向量索引缓存
      if (entry.embedding) {
        this._vectorCacheSet(entry.id, entry.embedding);
      }

      // BM25 索引更新
      if (this._hybridEnabled) {
        this._bm25Index.addDocument(entry.id, {
          summary: entry.summary ?? "",
          semantic_gist: entry.semantic_gist ?? "",
          payload: typeof entry.content_blob === "string" ? entry.content_blob : JSON.stringify(entry.content_blob),
        });
      }
    } catch (e) {
      // enrichment 失败不阻塞主流程——上报降级事件
      this._observer?.emit({
        type: PipelineEventType.MemorySqlDegraded,
        priority: PipelinePriority.HIGH,
        payload: { operation: "enrichPendingEntry", detail: String(e) },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    }
  }

  // ══════════════════════════════════════════════
  // 两阶段提交（直通后端）
  // ══════════════════════════════════════════════

  writePending(input: MemoryWriteInput): string {
    input = this._validateWrite(input);
    // R4-H3 fix: 两阶段提交路径提前计算 content_hash，确保 enrich 时去重缓存可命中
    if (!input.content_hash) {
      input.content_hash = crypto
        .createHash(CONTENT_HASH_ALGO)
        .update(input.summary + JSON.stringify(input.content_blob))
        .digest("hex");
    }
    return this._backend.writePending(input);
  }

  commitMemory(memoryId: string): boolean {
    const ok = this._backend.commitMemory(memoryId);
    if (ok) {
      const t0 = Date.now();
      this._enrichPendingEntry(memoryId).catch((err) => {
        this._observer?.emit({
          type: PipelineEventType.MemoryPersistFailed,
          priority: PipelinePriority.HIGH,
          payload: {
            operation: "commitMemory-enrichment",
            error: String(err),
          },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      }).finally(() => {
        void recordTelemetry("memory.write_duration_ms", Date.now() - t0, [{ key: "operation", value: "commit" }]).catch(() => {});
      });
    }
    return ok;
  }

  async rollback(memoryId: string): Promise<boolean> {
    try {
      return await this._backend.rollback(memoryId);
    } catch (e) {
      this._observer?.emit({
        type: PipelineEventType.MemorySqlDegraded,
        priority: PipelinePriority.HIGH,
        payload: { operation: "rollback", detail: String(e) },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
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

    let archived = 0;
    let obliterated = 0;

    // 通过无过滤 getAllEntries 获取全量条目
    try {
      // 后端 getAllEntries() 为同步 Map 操作，maintain() 同步签名安全调用
      const all = this._syncReadAll();
      if (!all) return { archived: 0, obliterated: 0, orphanedLinks: 0 };

      // 刷新生效——将 read() 中的老化 weight 异步回写到后端
      for (const e of all) {
        const daysSinceAccess = (Date.now() - (e.lastAccessedAt ?? e.createdAt)) / 86400000;
        if (daysSinceAccess > 7) {
          const aged = e.weight * Math.pow(WEIGHT_AGING_FACTOR, daysSinceAccess / 7);
          if (aged < e.weight * 0.9) {
            try {
              // 读-改-写：传完整条目仅更新 weight，避免整体替换抹掉其他字段。
              const p = this._backend.set(e.id, { ...e, weight: aged });
              if (p) p.catch((err) => this._safeAgingError(err, e.id, "set"));
            } catch (e) {
              // best-effort: 非关键降级路径
              this._safeAgingError(e, "batch", "set");
            }
          }
        }
      }

      // Phase 1: WeightAger 识别可归档的低权重过期 Active 记忆
      const freezeCandidates = this._ager.freezeStale(all, now);
      for (const c of freezeCandidates) {
        if (this.archive(c.id)) archived++;
      }

      // Phase 2: WeightAger 识别可湮灭的长期 Archived 记忆 — 先标记
      const obliterateCandidates = this._ager.obliterateFrozen(all, now);
      for (const c of obliterateCandidates) {
        this._pendingObliterate.add(c.id);
      }
      // 批量湮灭
      for (const id of this._pendingObliterate) {
        if (this.obliterate(id)) obliterated++;
      }
      this._pendingObliterate.clear();
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

  /** 从两级缓存中驱逐指定 memoryId 的所有关联项（供 archive/obliterate 共用） */
  private _evictCaches(memoryId: string): void {
    // _dedupCache 是 content_hash → id 映射，需按 value 查找后删除
    for (const [hash, id] of this._dedupCache) {
      if (id === memoryId) { this._dedupCache.delete(hash); break; }
    }
    this._vectorCache.delete(memoryId);
  }

  /** _dedupCache 带 LRU 淘汰的 setter */
  private _dedupCacheSet(contentHash: string, id: string): void {
    if (this._dedupCache.size >= MemoryStore.MAX_DEDUP_CACHE) {
      const first = this._dedupCache.keys().next().value;
      if (first !== undefined) this._dedupCache.delete(first);
    }
    this._dedupCache.set(contentHash, id);
  }

  /** _vectorCache 带 LRU 淘汰的 setter */
  private _vectorCacheSet(id: string, emb: number[]): void {
    if (this._vectorCache.size >= MemoryStore.MAX_VECTOR_CACHE) {
      const first = this._vectorCache.keys().next().value;
      if (first !== undefined) this._vectorCache.delete(first);
    }
    this._vectorCache.set(id, emb);
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
    if (this._observer) {
      this._observer.emit({
        type: PipelineEventType.MemorySqlDegraded,
        priority: PipelinePriority.NORMAL,
        payload: { operation, detail },
        timestamp: Date.now(),
      });
    } else {
      // R6-M7 fix: 无 observer 时 stderr fallback，防止降级事件完全静默
      process.stderr.write(`[MemoryStore:DEGRADED] ${operation}: ${detail}\n`);
    }
  }

  /** SHA256 去重缓存：content_hash → id。LRU 淘汰，上限 10000 */
  private readonly _dedupCache = new Map<string, string>();
  private static readonly MAX_DEDUP_CACHE = 10_000;
  /** 向量索引缓存：id → embedding。LRU 淘汰，上限 5000（每条约 3KB，总量 ~15MB） */
  private readonly _vectorCache = new Map<string, number[]>();
  private static readonly MAX_VECTOR_CACHE = 5_000;

  /** 内容去重——L1 适配层热缓存 → L2 后端 content_hash→id O(1) 索引（Core-3 T4：替代 O(n) 全表扫描） */
  private _tryDedup(contentHash: string): string | null {
    // L1: 适配层热缓存命中
    const cached = this._dedupCache.get(contentHash);
    if (cached) return cached;
    // L2: 后端 content_hash→id O(1) 索引
    try {
      const dupId = this._backend.findByContentHash(contentHash);
      if (dupId) {
        this._dedupCacheSet(contentHash, dupId);
        // R6-H9 fix: 去重审计——记录被去重的条目
        void recordTelemetry("memory.dedup_hit", 1, [
          { key: "matchType", value: "content_hash" },
          { key: "dupId", value: dupId },
        ]).catch(() => {});
        return dupId;
      }
      return null;
    } catch {
      this._emitDegraded("dedup-content-hash", "内容哈希去重查询失败");
      return null;
    }
  }

  /** 向量相似去重——每次查询前刷新缓存，避免过期数据（Core-3：统一使用 DedupService.vectorDedup 替代内联实现）
   * @param contentHash 条目的 SHA256 内容哈希——用于正确清理 _dedupCache（Map<contentHash, id>）
   * @returns 匹配到的已有条目 ID，null 表示无命中 */
  private async _tryVectorDedup(newId: string, embedding: number[], contentHash: string): Promise<string | null> {
    try {
      // R6-C3 fix: 使用 _vectorCache 替代全库读——消除 O(n) 深克隆开销
      // 仅在冷启动（缓存为空）时从后端加载一次
      if (this._vectorCache.size === 0) {
        const all = await this._backend.read({}, "HCA");
        // P0-A fix: 冷启动只装载 Active 条目的 embedding，避免归档/湮灭条目污染去重候选集
        for (const e of all) {
          if (e.semantic_state === "Active" && e.embedding) {
            this._vectorCacheSet(e.id, e.embedding);
          }
        }
      }
      // 从缓存构造最小化 MemoryEntry（仅 id + embedding，无需深克隆 payload）
      const cachedEntries: MemoryEntry[] = [];
      for (const [id, emb] of this._vectorCache) {
        if (id !== newId) cachedEntries.push({ id, embedding: emb } as MemoryEntry);
      }
      const matches = this._dedupService.vectorDedup(embedding, cachedEntries);
      const bestMatch = matches[0];
      if (bestMatch) {
        // P0-A fix: 校验 bestMatch 对应条目当前为 Active 态，否则为脏缓存命中→跳过
        const existingEntry = this._backend.peek(bestMatch.existingId);
        if (existingEntry && existingEntry.semantic_state !== "Active") {
          // 脏缓存：目标已归档/湮灭——清理缓存、不删 newId、返回 null 让新条目保留
          this._vectorCache.delete(bestMatch.existingId);
          for (const [h, eid] of this._dedupCache) {
            if (eid === bestMatch.existingId) { this._dedupCache.delete(h); break; }
          }
          return null;
        }
        await this._backend.delete(newId);
        this._bm25Index?.removeDocument(newId);
        this._dedupCache.delete(contentHash); // C8 fix: key 是 contentHash，非 entryId
        this._vectorCache.delete(newId);
        // R6-H9 fix: 向量去重审计
        void recordTelemetry("memory.dedup_hit", 1, [
          { key: "matchType", value: "vector" },
          { key: "newId", value: newId },
          { key: "existingId", value: bestMatch.existingId },
        ]).catch(() => {});
        return bestMatch.existingId; // R1 fix: 返回已有条目 ID 供 write() 返回
      }
      return null;
    } catch {
      this._emitDegraded("vector-dedup", "向量去重扫描失败，静默降级");
      return null;
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
        this.archive(e.id);
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
