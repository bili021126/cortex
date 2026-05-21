import type {
  MemoryEntry,
  MemoryLink,
  MemoryQuery,
  MemoryWriteInput,
  MemoryType,
  AgentType,
} from "@cortex/shared";
import { MemoryState, MemorySubType, LinkType, PipelineEventType, PipelinePriority } from "@cortex/shared";
import type { PipelineObserver } from "../core/pipeline-observer.js";
import * as crypto from "node:crypto";

import { SCHEMA_VERSION, EMBEDDING_DIM, LINK_WEIGHTS, CONTENT_HASH_ALGO, VECTOR_DEDUP_THRESHOLD, BFS_WEIGHT_THRESHOLD, MAX_LINKS_PER_NODE, WEIGHT_AGING_FACTOR, MAX_TOTAL_MEMORIES } from "./schema.js";
import { MemoryStorage } from "./storage.js";
import { MemoryPersistence } from "./persistence.js";
import { MemoryLifecycle } from "./lifecycle.js";
import { MemoryQueryEngine } from "./query.js";
import { SemiFinishedMgr } from "./semi-finished.js";
import { embedText } from "./embedding.js";

// MemoryWriteInput 已迁移至 @cortex/shared —— shared import 即可
// 迁移原因（艾尔海森 P0）：任何包只要想写入记忆条目就必须构造此接口
// 定义在 shared 中可避免各包自行重复定义

/**
 * MemoryStore —— 内存级记忆存储 + better-sqlite3 持久化（Facade）。
 *
 * @contract 模块边界契约（久岐忍 P1-5：模块边界缺少显式契约化定义 —— 已闭合）
 *
 * @depends  memory/persistence.ts（SQLite 持久化，WAL 模式，write-through）
 * @depends  memory/storage.ts（Map 内存存储 + 反序列化 + peek 冻结副本）
 * @depends  memory/lifecycle.ts（四态状态机 CAS + archive/freeze/obliterate）
 * @depends  memory/query.ts（内存扫描 + BFS 图遍历 + 向量召回）
 * @depends  @cortex/shared（MemoryEntry, MemoryState, MemoryQuery, LinkType 等类型）
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
export class MemoryStore {
  private _storage: MemoryStorage;
  private _persistence: MemoryPersistence;
  private _lifecycle: MemoryLifecycle;
  private _queryEngine: MemoryQueryEngine;
  /** P0 — 半成品管理 */
  private _semiFinished: SemiFinishedMgr;
  private _observer?: PipelineObserver;

  /** 公开 schema 版本常量，供外部校验 */
  static readonly SCHEMA_VERSION = SCHEMA_VERSION;

  constructor(observer?: PipelineObserver) {
    this._observer = observer;
    this._storage = new MemoryStorage(observer);
    this._persistence = new MemoryPersistence(observer);
    this._lifecycle = new MemoryLifecycle();
    this._queryEngine = new MemoryQueryEngine();
    this._semiFinished = new SemiFinishedMgr(this._lifecycle);
  }

  /**
   * 初始化持久化层（SQLite 建表 + 加载数据）
   * @fix D4 — 防止两次 init() 导致 DB 连接泄漏
   */
  async init(dbPath: string): Promise<void> {
    await this._persistence.init(dbPath, this._storage);
  }

  /** 持久化是否已启用 */
  get isPersisted(): boolean {
    return this._persistence.isEnabled;
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
    // M3: 关闭保护 — 非 active 态拒绝写入
    if (this._persistence.lifecycle !== "active") {
      throw new Error(`MemoryStore 已关闭(状态 ${this._persistence.lifecycle})，拒绝写入`);
    }

    // ── embedding 生成（静默降级：失败不阻塞写入） ──
    if (input.embedding === undefined) {
      try {
        const text = input.summary || JSON.stringify(input.content).slice(0, 2000);
        input.embedding = await embedText(text);
      } catch {
        // embedding 生成失败——记录但继续写入
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

    // embedding 维度校验
    if (input.embedding !== undefined && input.embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedding 维度不匹配: 期望 ${EMBEDDING_DIM}，实际 ${input.embedding.length}`
      );
    }

    // ── 内容去重：SHA256 精确匹配 ──
    const contentHash = crypto.createHash(CONTENT_HASH_ALGO)
      .update(input.summary + JSON.stringify(input.content))
      .digest("hex");
    const exactDup = this._storage.findByContentHash(contentHash);
    if (exactDup) {
      exactDup.accessCount++;
      exactDup.lastAccessedAt = Date.now();
      if (this._persistence.isEnabled) {
        try {
          this._persistence.run(
            "UPDATE memories SET access_count = ?, last_accessed_at = ? WHERE id = ?",
            [exactDup.accessCount, exactDup.lastAccessedAt, exactDup.id],
            "write.dedup"
          );
          this._persistence.scheduleFlush();
        } catch { /* DB 更新失败静默降级 */ }
      }
      return exactDup.id;
    }

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
          } catch { /* DB 更新失败静默降级 */ }
        }
        return similar.id;
      }
    }

    const entry = this._storage.insert(input, contentHash);
    const id = entry.id;

    if (this._persistence.isEnabled) {
      try {
        this._persistence.run(
          `INSERT INTO memories (id, memory_type, state, sub_type, content, summary, agent_type, creator_id, created_at, updated_at, last_accessed_at, access_count, weight, metadata, embedding, is_private) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.id,
            entry.memoryType,
            entry.state,
            entry.subType ?? null,
            entry.content ? JSON.stringify(entry.content) : null,
            entry.summary,
            entry.agentType,
            entry.creatorId,
            entry.createdAt,
            entry.createdAt,
            entry.lastAccessedAt,
            entry.accessCount,
            entry.weight,
            entry.metadata ? JSON.stringify(entry.metadata) : "{}",
            entry.embedding ? JSON.stringify(entry.embedding) : null,
            entry.isPrivate ? 1 : 0,
          ],
          "write"
        );
        this._persistence.scheduleFlush();
      } catch (e) {
        this._storage.memories.delete(id);
        throw e;
      }
    }

    // ── 总量上限：超出时 archive 最久未访问的记忆 ──
    if (this._storage.memories.size > MAX_TOTAL_MEMORIES) {
      const excess = this._storage.memories.size - MAX_TOTAL_MEMORIES;
      const candidates = Array.from(this._storage.memories.values())
        .filter((m) => m.state === MemoryState.Active)
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

    return id;
  }

  /**
   * 读取记忆（SQLite 优先 → 内存保底）
   *
   * 返回按 weight 排序的 MemoryEntry 列表
   *
   * @fix 语义卫生 — 自动 query embedding 生成 + 向量召回 + 权重自然老化
   */
  async read(query: MemoryQuery): Promise<MemoryEntry[]> {
    // D3: 关闭保护 — read() 在非 active 态时抛出异常，与 write() 一致
    if (this._persistence.lifecycle !== "active") {
      throw new Error(`MemoryStore 已关闭(状态 ${this._persistence.lifecycle})，拒绝读取`);
    }

    // ── 自动生成 query embedding（若未提供且有 keywords） ──
    if (!query.queryEmbedding && query.keywords && query.keywords.length > 0) {
      try {
        query.queryEmbedding = await embedText(query.keywords.join(" "));
      } catch { /* 降级跳过向量检索 */ }
    }

    const now = Date.now();
    const mode = query.queryMode ?? "csa";
    const resolvedBfsDepth = query.bfsDepth ?? (mode === "hca" ? 1 : 2);
    const resolvedBfsMaxNodes = query.bfsMaxNodes ?? 20;
    const resolvedTrackAccess = query.trackAccess ?? (mode === "csa");
    const resolvedLimit = query.limit ?? (mode === "hca" ? 10 : 3);

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

    // ── 权重自然老化：每 7 天未访问衰减 5% ──
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const agedEntries: Array<{ id: string; oldWeight: number; newWeight: number }> = [];
    for (const m of results) {
      const daysSinceAccess = (now - m.lastAccessedAt) / MS_PER_DAY;
      if (daysSinceAccess > 0) {
        const aged = m.weight * Math.pow(WEIGHT_AGING_FACTOR, daysSinceAccess / 7);
        if (Math.abs(aged - m.weight) > 0.0001) {
          agedEntries.push({ id: m.id, oldWeight: m.weight, newWeight: aged });
          m.weight = aged;
        }
      }
    }
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

    // 追踪访问（csa 模式下记录 accessCount + lastAccessedAt）
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
    // 生命周期守卫 — 与 write()/writePending() 一致
    if (this._persistence.lifecycle !== "active") {
      throw new Error(`MemoryStore 已关闭(状态 ${this._persistence.lifecycle})，拒绝写入`);
    }

    const source = this._storage.memories.get(sourceId);
    const target = this._storage.memories.get(targetId);
    if (!source || !target) return null;
    if (source.state === MemoryState.Obliterated || target.state === MemoryState.Obliterated) return null;

    let existing = this._storage.links.get(sourceId);
    if (!existing) {
      existing = [];
      this._storage.links.set(sourceId, existing);
    }

    // 幂等去重（AccessedDuring 是特殊 linkType，允许重复）
    if (linkType !== LinkType.AccessedDuring) {
      if (existing.some(l => l.targetId === targetId && l.linkType === linkType)) return null;
    }

    const now = Date.now();
    const link: MemoryLink = {
      id: `link_${crypto.randomUUID()}`,
      sourceId,
      targetId,
      linkType,
      weight: LINK_WEIGHTS[linkType] ?? 0.5,
      targetState: target.state,
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
  cas(memoryId: string, expected: MemoryState, newState: MemoryState): boolean {
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
    if (this._persistence.lifecycle !== "active") {
      throw new Error(`MemoryStore 已关闭(状态 ${this._persistence.lifecycle})，拒绝写入`);
    }

    if (input.embedding !== undefined && input.embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedding 维度不匹配: 期望 ${EMBEDDING_DIM}，实际 ${input.embedding.length}`
      );
    }

    const pendingInput = { ...input, subType: input.subType ?? MemorySubType.Intent };
    const id = this._semiFinished.writePending(this._storage, pendingInput);

    if (this._persistence.isEnabled) {
      const entry = this._storage.memories.get(id);
      if (entry) {
        try {
          this._persistence.run(
            `INSERT INTO memories (id, memory_type, state, sub_type, content, summary, agent_type, creator_id, created_at, updated_at, last_accessed_at, access_count, weight, metadata, embedding, is_private) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              entry.id, entry.memoryType, entry.state,
              entry.subType ?? null,
              entry.content ? JSON.stringify(entry.content) : null,
              entry.summary, entry.agentType, entry.creatorId,
              entry.createdAt, entry.createdAt, // updated_at = created_at
              entry.lastAccessedAt, entry.accessCount,
              entry.weight,
              entry.metadata ? JSON.stringify(entry.metadata) : "{}",
              entry.embedding ? JSON.stringify(entry.embedding) : null,
              entry.isPrivate ? 1 : 0,
            ],
            "writePending"
          );
          this._persistence.scheduleFlush();
        } catch (e) {
          this._storage.memories.delete(id);
          throw e;
        }
      }
    }

    return id;
  }

  /**
   * 提交半成品 → Active
   *
   * 委托 SemiFinishedMgr.commit，其内部使用 _statePersistFn 持久化状态变更。
   * isEnabled 为 true 时传入回调 persister，否则为 undefined（纯内存操作）。
   */
  commitMemory(memoryId: string): boolean {
    const ok = this._semiFinished.commit(
      this._storage, memoryId,
      this._statePersistFn("commitMemory"),
      this._persistence.isEnabled
        ? (id: string, subType: MemorySubType) => {
            this._persistence.run(
              `UPDATE memories SET state = 'ACTIVE', sub_type = ? WHERE id = ?`,
              [subType, id],
              "commitMemory"
            );
            this._persistence.scheduleFlush();
          }
        : undefined
    );
    return ok;
  }

  getPending(): MemoryEntry[] {
    return this._semiFinished.getPending(this._storage);
  }

  hasPending(): boolean {
    return this._semiFinished.hasPending(this._storage);
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
   * 生成状态持久化回调（供 MemoryLifecycle 使用）
   *
   * 返回一个函数，调用 persistence.run() 写入状态变更 + scheduleFlush
   */
  private _statePersistFn(opName: string): ((id: string, state: MemoryState) => void) | undefined {
    if (!this._persistence.isEnabled) return undefined;
    return (id: string, state: MemoryState) => {
      this._persistence.run("UPDATE memories SET state = ? WHERE id = ?", [state, id], opName);
      this._persistence.scheduleFlush();
    };
  }

  /**
   * SQLite 读取 → 反序列化
   *
   * DB 异常时降级至内存扫描（memScanRead + 日志警告）
   */
  private _persistenceRead(query: MemoryQuery, now: number): MemoryEntry[] {
    try {
      const rawRows = this._persistence.sqlRead(query, now);
      const rows: MemoryEntry[] = [];
      for (const raw of rawRows) {
        const entry = this._storage.deserializeRow(raw);
        if (entry) rows.push(entry);
      }

      if (query.metadataFilter && Object.keys(query.metadataFilter).length > 0) {
        return rows.filter((m) => {
          if (!m.metadata) return false;
          return Object.entries(query.metadataFilter!).every(([k, v]) => m.metadata![k] === v);
        });
      }

      return rows;
    } catch (e) {
      // 上报异常
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
