import {
  PipelineEventType,
  PipelinePriority,
  type IPipelineObserver,
  type IMemoryStore,
  type MaintainReport,
  type MemoryEntry,
  type MemoryLink,
  type MemoryQuery,
  type MemoryWriteInput,
  type ReadMode,
 type LinkType} from "@cortex/shared";
import * as crypto from "node:crypto";
import * as fs from "node:fs";

import { SCHEMA_VERSION, EMBEDDING_DIM, LINK_WEIGHTS, CONTENT_HASH_ALGO, VECTOR_DEDUP_THRESHOLD, WEIGHT_AGING_FACTOR, MAX_TOTAL_MEMORIES, STALE_FREEZE_DAYS, FROZEN_OBLITERATE_DAYS, MAINTENANCE_WEIGHT_THRESHOLD } from "./schema.js";
import { MemoryStorage } from "./storage.js";
import { MemoryPersistence } from "./persistence.js";
import { MemoryLifecycle } from "./lifecycle.js";
import { MemoryQueryEngine } from "./query.js";
import { type IEmbeddingService, defaultEmbeddingService } from "./embedding.js";

// MemoryWriteInput 已迁移至 @cortex/shared —— shared import 即可
// 迁移原因（艾尔海森 P0）：任何包只要想写入记忆条目就必须构造此接口
// 定义在 shared 中可避免各包自行重复定义

// MaintainReport 已迁移至 @cortex/shared —— shared import 即可

/**
 * MemoryStore —— 内存级记忆存储 + better-sqlite3 持久化（Facade）。
 *
 * @contract 模块边界契约（久岐忍 P1-5：模块边界缺少显式契约化定义 —— 已闭合）
 *
 * @depends  memory/persistence.ts（SQLite 持久化，WAL 模式，write-through）
 * @depends  memory/storage.ts（Map 内存存储 + 反序列化 + peek 冻结副本）
 * @depends  memory/lifecycle.ts（四态状态机 CAS + archive/freeze/obliterate）
 * @depends  memory/query.ts（内存扫描 + BFS 图遍历 + 向量召回）
 * @depends  @cortex/shared（MemoryEntry, SemanticState, MemoryQuery, LinkType 等类型）
 * @dataflow write(input) → MemoryStorage.insert → MemoryPersistence.run (write-through)
 *           → scheduleFlush (防抖) → flush (WAL checkpoint)
 *           read(query) → MemoryQueryEngine.memScanRead/vectorRecall/bfsExpand
 *           → 排序+限量 → MemoryEntry[]
 *          异常路径：DB 失败回滚内存（假阳性禁止），SQL 失败退化至内存扫描
 *
 *   ┌─ MemoryStore (Facade) ────────────────────────────────────┐
 *   │ write()/read()/link()/cas()/archive()/freeze()/obliterate() │
 *   │ init()/close()/flush()                                     │
 *   ├───────────────────────────────────────────────────────────┤
 *   │ ┌─ MemoryStorage ──────┐ ┌─ MemoryPersistence ──────┐  │
 *   │ │ Map 内存存储          │ │ SQLite WAL 持久化         │  │
 *   │ │ insert/delete/get     │ │ init/close/run/runBatch   │  │
 *   │ │ peek (冻结副本)       │ │ sqlRead/flush/scheduleFlush│  │
 *   │ │ deserializeRow        │ │ updateAccessTracking      │  │
 *   │ └──────────────────────┘ └───────────────────────────┘  │
 *   │ ┌─ MemoryLifecycle ────┐ ┌─ MemoryQueryEngine ──────┐  │
 *   │ │ CAS 状态机            │ │ memScanRead               │  │
 *   │ │ archive/freeze/       │ │ vectorRecall              │  │
 *   │ │ obliterate            │ │ bfsExpand                 │  │
 *   │ └──────────────────────┘ └───────────────────────────┘  │
 *   │ ┌─ SemiFinishedMgr ────┐                               │
 *   │ │ writePending/commit   │                               │
 *   │ └──────────────────────┘                               │
 *   └─────────────────────────────────────────────────────────┘
 */
export class MemoryStore implements IMemoryStore {
  private _storage: MemoryStorage;
  private _persistence: MemoryPersistence;
  private _lifecycle: MemoryLifecycle;
  private _queryEngine: MemoryQueryEngine;
  private _observer?: IPipelineObserver;
  private readonly _embedder: IEmbeddingService;
  /** 当前运行会话标识——beginSession() 生成，endSession() 清除 */
  private _sessionId?: string;

  /** P1-六层防御：写前校验钩子（由 ConsistencyLayer 注入） */
  private _preWriteHook?: (input: MemoryWriteInput) => MemoryWriteInput;

  /** 公开 schema 版本常量，供外部校验 */
  static readonly SCHEMA_VERSION = SCHEMA_VERSION;

  constructor(observer?: IPipelineObserver, embedder?: IEmbeddingService) {
    this._observer = observer;
    this._embedder = embedder ?? defaultEmbeddingService;
    this._storage = new MemoryStorage(observer);
    this._persistence = new MemoryPersistence(observer);
    this._lifecycle = new MemoryLifecycle();
    this._queryEngine = new MemoryQueryEngine();
  }

  /**
   * 初始化持久化层（SQLite 建表 + 加载数据）
   * @fix D4 — 防止两次 init() 导致 DB 连接泄漏
   * @fix DB-corruption — 检测 DB 损坏后自动删除并重建
   */
  async init(dbPath: string): Promise<void> {
    try {
      await this._persistence.init(dbPath, this._storage);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/disk image is malformed|file is not a database|database.*corrupt/i.test(msg)) {
        console.warn(
          `[MemoryStore] SQLite DB 损坏 (${msg.slice(0, 100)})，将删除并重建: ${dbPath}`
        );
        // 关闭已损坏的 DB 连接（忽略关闭错误——DB 已不可靠）
        try { (this._persistence as unknown as { _db?: { close(): void } })._db?.close(); } catch { /* DB 已不可用 */ }
        // 删除损坏的 DB 文件及 WAL/SHM 残留
        for (const suffix of ["", "-wal", "-shm"]) {
          try { fs.unlinkSync(dbPath + suffix); } catch { /* 文件可能不存在 */ }
        }
        // 重建持久层并重试
        this._persistence = new MemoryPersistence(this._observer);
        await this._persistence.init(dbPath, this._storage);
        return;
      }
      throw err;
    }
  }

  /** 持久化是否已启用 */
  get isPersisted(): boolean {
    return this._persistence.isEnabled;
  }

  /** 当前运行会话标识。undefined 为未初始化或向后兼容 */
  get sessionId(): string | undefined {
    return this._sessionId;
  }

  /**
   * 开始新会话——生成或接受唯一 sessionId，后续 write/writePending 自动注入。
   * 每次 executeAll() 调用前由调度层触发。
   * @param externalId 可选——外部传入的 sessionId（如 Scheduler 生成的 run-*），传入时优先使用
   */
  beginSession(externalId?: string): string {
    this._sessionId = externalId ?? `mem-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    return this._sessionId;
  }

  /**
   * 终结当前会话——归档本 session 的 Active 记忆，湮灭 Pending 记忆。
   * @returns 清理的记忆数量
   */
  async endSession(): Promise<number> {
    if (!this._sessionId) return 0;
    let cleaned = 0;
    const sessionEntries = this._getBySessionInternal(this._sessionId);
    for (const m of sessionEntries) {
      if (m._pending) {
        // Pending 态直接湮灭——Agent 中途写入但未 commit
        this._lifecycle.obliterate(this._storage, m.id, this._statePersistFn("endSession-obliterate"));
        cleaned++;
      } else if (m.semantic_state === "Active") {
        // Active 态归档——已完成的任务记忆保留但标记
        this._lifecycle.archive(this._storage, m.id, this._statePersistFn("endSession-archive"));
        cleaned++;
      }
    }
    this._sessionId = undefined;
    return cleaned;
  }

  /**
   * 按 sessionId 查询指定会话的所有记忆。
   * 用于跨 run 认知共享和污染诊断。
   */
  getBySession(sessionId: string): MemoryEntry[] {
    return this._getBySessionInternal(sessionId);
  }

  /**
   * 显式回滚——将指定 Pending 记忆直接湮灭。
   * 两阶段提交的终止路径：prepare → rollback（不走 commit→Active 路径）
   */
  rollback(memoryId: string): boolean {
    const m = this._storage.memories.get(memoryId);
    if (!m) return false;
    if (!m._pending) return false;
    const ok = this._lifecycle.obliterate(this._storage, memoryId, this._statePersistFn("rollback"));
    if (ok) delete m._pending;
    return ok;
  }

  /** 内部：按 sessionId 扫描存储 */
  private _getBySessionInternal(sessionId: string): MemoryEntry[] {
    const results: MemoryEntry[] = [];
    for (const m of this._storage.memories.values()) {
      if (m.sessionId === sessionId) results.push(m);
    }
    return results;
  }

  /**
   * P1-六层防御：注入写前校验钩子（由 ConsistencyLayer 注入）。
   * 在 write()/writePending() 处理前调用，执行 SchemaEnforcer 校验 + IntentFactWall 标记。
   */
  setPreWriteHook(hook: (input: MemoryWriteInput) => MemoryWriteInput): void {
    this._preWriteHook = hook;
  }

  /**
   * 写入一条记忆（内存 + DB write-through）
   *
   * 流程：embedding 生成 → 内容去重（SHA256 + 向量相似） → Storage.insert → Persistence.run → scheduleFlush
   * 异常路径：DB 失败时回滚内存（假阳性禁止原则），embedding 失败静默降级
   *
   * @fix 语义卫生 — async embedding 生成 + SHA256 精确去重 + 向量相似去重 + 总量上限
   */
  async write(input: MemoryWriteInput): Promise<string> {
    input = this._validateWrite(input);
    // v2.5.41: 自动注入 sessionId——当前会话存在时注入，向后兼容
    if (this._sessionId && !input.sessionId) {
      input.sessionId = this._sessionId;
    }

    // ── embedding 生成（静默降级：失败不阻塞写入）──
    if (input.embedding === undefined) {
      try {
        const text = input.semantic_gist || JSON.stringify(input.content_blob).slice(0, 2000);
        input.embedding = await this._embedder.embedText(text);
      } catch {
        if (this._observer) {
          this._observer.emit({
            type: PipelineEventType.MemorySqlDegraded,
            priority: PipelinePriority.NORMAL,
            payload: { operation: "embedding", detail: "embedding 生成失败，已降级跳过" },
            timestamp: Date.now(),
          });
        }
      }
    }

    if (input.embedding !== undefined && input.embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedding 维度不匹配: 期望 ${EMBEDDING_DIM}，实际 ${input.embedding.length}`
      );
    }

    // ── 内容去重：SHA256 精确匹配 ──
    const contentHash = this._computeContentHash(input);
    const exactDup = this._tryDedup(contentHash);
    if (exactDup) return exactDup.id;

    // ── 内容去重：向量相似匹配 ──
    if (input.embedding) {
      const similar = this._storage.findBySimilarity(input.embedding, VECTOR_DEDUP_THRESHOLD);
      if (similar) {
        similar.accessCount++;
        similar.lastAccessedAt = Date.now();
        if (this._persistence.isEnabled) {
          try {
            this._persistence.run(
              "UPDATE memories SET access_count = ?, last_accessed_at = ? WHERE id = ?",
              [similar.accessCount, similar.lastAccessedAt, similar.id],
              "write.vector-dedup"
            );
            this._persistence.scheduleFlush();
          } catch {
            similar.accessCount--;
            this._observer?.emit({
              type: PipelineEventType.MemorySqlDegraded,
              priority: PipelinePriority.NORMAL,
              payload: { operation: "write.vector-dedup", detail: "DB UPDATE 失败，accessCount 已回滚" },
              timestamp: Date.now(),
            });
          }
        }
        return similar.id;
      }
    }

    const entry = this._storage.insert(input, contentHash);
    this._persistInsert(entry, "write");

    // ── 总量上限：超出时 archive 最久未访问的记忆 ──
    if (this._storage.memories.size > MAX_TOTAL_MEMORIES) {
      const excess = this._storage.memories.size - MAX_TOTAL_MEMORIES;
      const candidates = Array.from(this._storage.memories.values())
        .filter((m) => m.semantic_state === "Active")
        .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
        .slice(0, excess);
      for (const m of candidates) {
        this._lifecycle.archive(this._storage, m.id, this._statePersistFn("auto-archive"));
      }
      if (candidates.length > 0 && this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemorySqlDegraded,
          priority: PipelinePriority.NORMAL,
          payload: { operation: "auto-archive", detail: `已自动归档 ${candidates.length} 条最久未访问记忆（总量超 ${MAX_TOTAL_MEMORIES} 上限）` },
          timestamp: Date.now(),
          notificationType: "FYI",
        });
      }
    }

    return entry.id;
  }

  /**
   * 读取记忆（SQLite 优先 → 内存保底）
   *
   * 返回按 weight 排序的 MemoryEntry 列表
   *
   * @fix 语义卫生 — 自动 query embedding 生成 + 向量召回 + 权重自然老化
   */
  async read(query: MemoryQuery, mode: ReadMode = "CSA"): Promise<MemoryEntry[]> {
    if (this._persistence.lifecycle !== "active") {
      throw new Error(`MemoryStore 已关闭(状态 ${this._persistence.lifecycle})，拒绝读取`);
    }

    // ── 自动生成 query embedding（若未提供且有 keywords）──
    if (!query.queryEmbedding && query.keywords && query.keywords.length > 0) {
      try {
        query.queryEmbedding = await this._embedder.embedText(query.keywords.join(" "));
      } catch { /* 降级跳过向量检索 */ }
    }

    const now = Date.now();
    const resolvedBfsDepth = query.bfsDepth ?? (mode === "HCA" ? 1 : 2);
    const resolvedBfsMaxNodes = query.bfsMaxNodes ?? 20;
    const resolvedTrackAccess = mode === "CSA";
    const resolvedLimit = query.limit ?? (mode === "HCA" ? 10 : 3);

    let results: MemoryEntry[];

    if (this._persistence.isEnabled) {
      results = this._persistenceRead(query, now);
    } else {
      results = this._queryEngine.memScanRead(this._storage, query, now);
    }

    // 向量召回（如果 query 提供了 embedding）
    if (query.queryEmbedding && results.length > 0) {
      const topK = query.vectorTopK ?? 50;
      results = this._queryEngine.vectorRecall(query.queryEmbedding, results, topK);
    }

    // BFS 链路展开
    if (resolvedBfsDepth > 0 && results.length > 0) {
      const resolvedBfsDirection = query.bfsDirection ?? "outbound";
      results = this._queryEngine.bfsExpand(
        this._storage,
        results,
        resolvedBfsDepth,
        resolvedBfsMaxNodes,
        query.linkTypes,
        resolvedBfsDirection
      );
    }

    // 追踪访问（csa 模式下记录 accessCount + lastAccessedAt）
    // ⚠️ 必须在权重老化之前执行：权重老化会浅拷贝 results，
    // 若在此之后做访问追踪，peek() 返回的 _storage 原始对象 accessCount 永远为 0。
    if (resolvedTrackAccess) {
      // 记录变更前的值，用于持久化
      const originals = new Map(results.map((m) => [m.id, { accessCount: m.accessCount, lastAccessedAt: m.lastAccessedAt }]));

      for (const m of results) {
        m.accessCount++;
        m.lastAccessedAt = now;
      }

      // 持久化访问追踪（DB 失败不阻塞读取，降级忽略）
      if (this._persistence.isEnabled && results.length > 0) {
        try {
          this._persistence.runBatch(
            "UPDATE memories SET access_count = ?, last_accessed_at = ? WHERE id = ?",
            results.map((m) => [m.accessCount, m.lastAccessedAt, m.id]),
            "read.trackAccess"
          );
          this._persistence.scheduleFlush();
        } catch (e) {
          // 访问追踪失败 → 回滚内存中的 accessCount 和 lastAccessedAt
          for (const m of results) {
            const orig = originals.get(m.id);
            if (orig) {
              m.accessCount = orig.accessCount;
              m.lastAccessedAt = orig.lastAccessedAt;
            }
          }
          // DB 读取降级：若 observer 存在则发射 sql_degraded 事件
          if (this._observer) {
            this._observer.emit({
              type: PipelineEventType.MemorySqlDegraded,
              priority: PipelinePriority.NORMAL,
              payload: { operation: "trackAccess", detail: String(e).slice(0, 200) },
              timestamp: Date.now(),
            });
          }
        }
      }
    }

    // ── 权重自然老化：每 7 天未访问衰减 5% ──
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const agedEntries: Array<{ id: string; oldWeight: number; newWeight: number }> = [];
    // @fix M11 — 浅拷贝 results 避免时间衰减修改原始 MemoryEntry 对象
    // 反复调用 read() 不应持续衰减 weight
    results = results.map((m) => ({
      ...m,
      weight: (() => {
        const daysSinceAccess = (now - m.lastAccessedAt) / MS_PER_DAY;
        if (daysSinceAccess > 0) {
          const aged = m.weight * Math.pow(WEIGHT_AGING_FACTOR, daysSinceAccess / 7);
          if (Math.abs(aged - m.weight) > 0.0001) {
            agedEntries.push({ id: m.id, oldWeight: m.weight, newWeight: aged });
            return aged;
          }
        }
        return m.weight;
      })(),
    }));

    // 老化权重持久化（失败静默降级）
    if (agedEntries.length > 0 && this._persistence.isEnabled) {
      try {
        this._persistence.runBatch(
          "UPDATE memories SET weight = ? WHERE id = ?",
          agedEntries.map((e) => [e.newWeight, e.id]),
          "read.weightAging"
        );
        this._persistence.scheduleFlush();
      } catch { /* 权重老化持久化失败静默降级 */ }
    }

    // 按 weight 降序排列
    results.sort((a, b) => b.weight - a.weight);

    // 截取
    if (resolvedLimit > 0) {
      results = results.slice(0, resolvedLimit);
    }

    return results;
  }

  /**
   * 在两条记忆之间建立关联（内存 + DB write-through）
   *
   * 流程：内存写入 → Persistence.run → scheduleFlush
   * 异常路径：DB 失败时回滚内存（existing.pop）
   */
  link(sourceId: string, targetId: string, linkType: LinkType): MemoryLink | null {
    if (this._persistence.lifecycle !== "active") {
      throw new Error(`MemoryStore 已关闭(状态 ${this._persistence.lifecycle})，拒绝写入`);
    }

    const source = this._storage.memories.get(sourceId);
    const target = this._storage.memories.get(targetId);
    if (!source || !target) return null;
    if (source.semantic_state === "Obliterated" || target.semantic_state === "Obliterated") return null;

    let existing = this._storage.links.get(sourceId);
    if (!existing) {
      existing = [];
      this._storage.links.set(sourceId, existing);
    }

    // 幂等去重
    if (existing.some(l => l.targetId === targetId && l.linkType === linkType)) return null;

    const now = Date.now();
    const link: MemoryLink = {
      id: `link_${crypto.randomUUID()}`,
      sourceId,
      targetId,
      linkType,
      weight: LINK_WEIGHTS[linkType] ?? 0.5,
      targetState: target.semantic_state,
      lastAccessedAt: now,
    };
    existing.push(link);

    if (this._persistence.isEnabled) {
      try {
        this._persistence.run(
          `INSERT INTO links (id, source_id, target_id, link_type, weight, target_state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [link.id, link.sourceId, link.targetId, link.linkType, link.weight, link.targetState, now],
          "link"
        );
        this._persistence.scheduleFlush();
      } catch (e) {
        existing.pop();
        throw e;
      }
    }

    return link;
  }

  getLinks(sourceId: string): MemoryLink[] {
    return this._storage.links.get(sourceId) ?? [];
  }

  has(memoryId: string): boolean {
    return this._storage.memories.has(memoryId);
  }

  /**
   * CAS 状态变更 — 委托 MemoryLifecycle
   *
   * @fix Core-1 CAS 封闭：所有状态变更必须经过此处，不允许外部直接修改 state
   */
  cas(memoryId: string, expected: string, newState: string): boolean {
    return this._lifecycle.cas(
      this._storage, memoryId, expected, newState,
      this._statePersistFn("cas"),
    );
  }

  archive(memoryId: string): boolean {
    return this._lifecycle.archive(this._storage, memoryId, this._statePersistFn("archive"));
  }

  freeze(memoryId: string): boolean {
    return this._lifecycle.freeze(this._storage, memoryId, this._statePersistFn("freeze"));
  }

  obliterate(memoryId: string): boolean {
    return this._lifecycle.obliterate(this._storage, memoryId, this._statePersistFn("obliterate"));
  }

  /**
   * 写入一条半成品记忆（semifinished — Pending 状态）
   *
   * 流程：SemiFinishedMgr.writePending → Persistence.run → scheduleFlush
   * 异常路径：DB 失败时回滚内存（假阳性禁止原则）
   */
  writePending(input: MemoryWriteInput): string {
    input = this._validateWrite(input);
    // v2.5.41: 自动注入 sessionId
    if (this._sessionId && !input.sessionId) {
      input.sessionId = this._sessionId;
    }

    const contentHash = this._computeContentHash(input);
    const exactDup = this._tryDedup(contentHash);
    if (exactDup) return exactDup.id;

    const pendingEntry = this._storage.insert(input, contentHash);
    const m = this._storage.memories.get(pendingEntry.id);
    if (m) {
      // v3: Pending 为工程态标记，不影响 semantic_state
      m._pending = true;
    }

    this._persistInsert(pendingEntry, "writePending");
    return pendingEntry.id;
  }

  commitMemory(memoryId: string): boolean {
    const m = this._storage.memories.get(memoryId);
    if (!m) return false;
    const ok = this._lifecycle.commit(this._storage, memoryId, this._statePersistFn("commitMemory"));
    if (ok) {
      delete m._pending;
      if (this._persistence.isEnabled) {
        try {
          this._persistence.run(
            "UPDATE memories SET semantic_state = ? WHERE id = ?",
            ["Active", memoryId],
            "commitMemory"
          );
          this._persistence.scheduleFlush();
        } catch (e) {
          m._pending = true;
          if (this._observer) {
            this._observer.emit({
              type: PipelineEventType.MemoryPersistFailed,
              priority: PipelinePriority.HIGH,
              payload: { operation: "commitMemory", detail: String(e).slice(0, 200), memoryId },
              timestamp: Date.now(),
              notificationType: "WARNING",
            });
          }
        }
      }
    }
    return ok;
  }

  getPending(): MemoryEntry[] {
    const results: MemoryEntry[] = [];
    for (const m of this._storage.memories.values()) {
      if (m._pending) results.push(m);
    }
    return results;
  }

  hasPending(): boolean {
    for (const m of this._storage.memories.values()) {
      if (m._pending) return true;
    }
    return false;
  }

  peek(memoryId: string): Readonly<MemoryEntry> | undefined {
    return this._storage.peek(memoryId);
  }

  get size(): number {
    return this._storage.size;
  }

  async flush(): Promise<void> {
    await this._persistence.flush();
  }

  /**
   * 关闭持久化层并清理 observer 资源。
   * @fix P0-3 — 清理 _observer 引用防止重新 init() 后 handler 残留
   */
  async close(): Promise<void> {
    await this._persistence.close();
    this._observer = undefined;
  }

  /**
   * 主动维护：冻结过期记忆 + 湮灭冻结记忆 + 清理孤儿边。
   *
   * 与被动衰减（read() 中的权重老化）互补：
   *   - 权重老化：被动衰减数值（read 触发）
   *   - 主动维护：状态转移 + 清理（定期调用）
   *
   * 流程：
   *   1. Active 记忆：lastAccessedAt > STALE_FREEZE_DAYS 且 weight < MAINTENANCE_WEIGHT_THRESHOLD → Freeze
   *   2. Frozen 记忆：metadata.frozenAt > FROZEN_OBLITERATE_DAYS → Obliterate
   *   3. 清理孤儿边：targetId 指向不存在/湮灭记忆的边
   *
   * @returns 维护报告
   */
  maintain(): MaintainReport {
    if (this._persistence.lifecycle !== "active") {
      return { archived: 0, obliterated: 0, orphanedLinks: 0, skipped: "MemoryStore 未处于 active 状态" };
    }

    const now = Date.now();
    const freezeThreshold = now - STALE_FREEZE_DAYS * 24 * 60 * 60 * 1000;
    const obliterateThreshold = now - FROZEN_OBLITERATE_DAYS * 24 * 60 * 60 * 1000;
    const archivePersist = this._statePersistFn("maintain.archive");
    const obliteratePersist = this._statePersistFn("maintain.obliterate");

    let archived = 0;
    let obliterated = 0;

    // Phase 1: 归档过期低权重 Active 记忆
    for (const [, m] of this._storage.memories) {
      if (m.semantic_state !== "Active") continue;
      if (m.lastAccessedAt > freezeThreshold) continue;
      if (m.weight >= MAINTENANCE_WEIGHT_THRESHOLD) continue;

      const ok = this._lifecycle.archive(this._storage, m.id, archivePersist);
      if (ok) archived++;
    }

    // Phase 2: 湮灭长期 Archived 记忆
    for (const [, m] of this._storage.memories) {
      if (m.semantic_state !== "Archived") continue;
      if (m.lastAccessedAt > obliterateThreshold && (m.expires_at ?? 0) === 0) continue;

      const ok = this._lifecycle.obliterate(this._storage, m.id, obliteratePersist);
      if (ok) obliterated++;
    }

    // Phase 3: 清理孤儿边
    const orphanedLinks = this._storage.cleanOrphanedLinks();

    if (this._persistence.isEnabled && (archived > 0 || obliterated > 0 || orphanedLinks > 0)) {
      this._persistence.scheduleFlush();
    }

    return { archived, obliterated, orphanedLinks };
  }

  /**
   * 写入前公共校验：生命周期守卫 + 写前 Hook + embedding 维度校验。
   * write() 与 writePending() 共享此校验。
   */
  /**
   * 计算 SHA256 内容哈希 — write() / writePending() 共用的去重基础
   * 输入相同摘要+内容 → 相同哈希 → 识别重复记忆
   */
  private _computeContentHash(input: MemoryWriteInput): string {
    return crypto.createHash(CONTENT_HASH_ALGO)
      .update(input.summary + JSON.stringify(input.content_blob))
      .digest("hex");
  }

  /**
   * SHA256 内容去重 — write() / writePending() 共用
   * 命中时自动 bump accessCount 并持久化，返回已存在的 MemoryEntry 或 null
   */
  private _tryDedup(contentHash: string): MemoryEntry | null {
    const dup = this._storage.findByContentHash(contentHash);
    if (!dup) return null;

    dup.accessCount++;
    dup.lastAccessedAt = Date.now();
    if (this._persistence.isEnabled) {
      try {
        this._persistence.run(
          "UPDATE memories SET access_count = ?, last_accessed_at = ? WHERE id = ?",
          [dup.accessCount, dup.lastAccessedAt, dup.id],
          "dedup"
        );
        this._persistence.scheduleFlush();
      } catch {
        dup.accessCount--;
        this._observer?.emit({
          type: PipelineEventType.MemorySqlDegraded,
          priority: PipelinePriority.NORMAL,
          payload: { operation: "dedup", detail: "DB UPDATE 失败，accessCount 已回滚" },
          timestamp: Date.now(),
        });
      }
    }
    return dup;
  }

  private _validateWrite(input: MemoryWriteInput): MemoryWriteInput {
    if (this._persistence.lifecycle !== "active") {
      throw new Error(`MemoryStore 已关闭(状态 ${this._persistence.lifecycle})，拒绝写入`);
    }
    if (this._preWriteHook) {
      input = this._preWriteHook(input);
    }
    if (input.embedding !== undefined && input.embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedding 维度不匹配: 期望 ${EMBEDDING_DIM}，实际 ${input.embedding.length}`
      );
    }
    return input;
  }

  /**
   * 持久化 INSERT：将内存 MemoryEntry 写入 SQLite。
   * write() 与 writePending() 共享此段——二者 INSERT 语句完全相同。
   * DB 失败时回滚内存（假阳性禁止原则）。
   */
  private _persistInsert(entry: MemoryEntry, opName: string): void {
    if (!this._persistence.isEnabled) return;
    const e = this._storage.memories.get(entry.id);
    if (!e) return;
    try {
      this._persistence.run(
        `INSERT INTO memories (id, semantic_state, kind, source, summary, semantic_gist, content_blob, content_hash, embedding, weight, access_count, created_at, last_accessed_at, expires_at, session_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id,
          e.semantic_state,
          e.kind,
          JSON.stringify(e.source),
          e.summary,
          e.semantic_gist,
          JSON.stringify(e.content_blob),
          e.content_hash,
          e.embedding ? JSON.stringify(e.embedding) : null,
          e.weight,
          e.accessCount,
          e.createdAt,
          e.lastAccessedAt,
          e.expires_at ?? null,
          e.sessionId ?? null,
          Date.now(),
        ],
        opName
      );
      this._persistence.scheduleFlush();
    } catch (err) {
      this._storage.memories.delete(entry.id);
      throw err;
    }
  }

  private _statePersistFn(opName: string): ((id: string, state: string) => void) | undefined {
    if (!this._persistence.isEnabled) return undefined;
    return (id: string, state: string) => {
      this._persistence.run("UPDATE memories SET semantic_state = ? WHERE id = ?", [state, id], opName);
      this._persistence.scheduleFlush();
    };
  }

  private _persistenceRead(query: MemoryQuery, now: number): MemoryEntry[] {
    try {
      const rawRows = this._persistence.sqlRead(query, now);
      const rows: MemoryEntry[] = [];
      for (const raw of rawRows) {
        const entry = this._storage.deserializeRow(raw);
        if (entry) rows.push(entry);
      }

      const metadataFilter = query.metadataFilter;
      if (metadataFilter && Object.keys(metadataFilter).length > 0) {
        return rows.filter((m) => {
          return Object.entries(metadataFilter).every(([k, v]) => m.content_blob[k as string] === v);
        });
      }

      return rows;
    } catch (e) {
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemorySqlDegraded,
          priority: PipelinePriority.NORMAL,
          payload: { operation: "sqlRead", detail: String(e).slice(0, 200) },
          timestamp: Date.now(),
        });
      } else {
        console.warn(`[MemoryStore] SQLite 读取失败，降级至内存扫描: ${e}`);
      }
      return this._queryEngine.memScanRead(this._storage, query, now);
    }
  }
}
