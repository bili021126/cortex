import type {
  MemoryEntry,
  MemoryLink,
  MemoryQuery,
  MemoryType,
  AgentType,
} from "@cortex/shared";
import { MemoryState, LinkType, PipelineEventType, PipelinePriority } from "@cortex/shared";
import type { PipelineObserver } from "./pipeline-observer.js";
import * as crypto from "node:crypto";

import { SCHEMA_VERSION, LINK_WEIGHTS } from "./memory/schema.js";
import { MemoryStorage } from "./memory/storage.js";
import { MemoryPersistence } from "./memory/persistence.js";
import { MemoryLifecycle } from "./memory/lifecycle.js";
import { MemoryQueryEngine } from "./memory/query.js";

/** MemoryEntry 构造参数（id/createdAt/lastAccessedAt 自动生成） */
export interface MemoryWriteInput {
  memoryType: MemoryType;
  content: Record<string, unknown>;
  summary: string;
  agentType: AgentType;
  creatorId: string;
  weight?: number;
  createdAt?: number;
  projectFingerprint?: string;
  metadata?: Record<string, unknown>;
  isPrivate?: boolean;
  /** 语义嵌入向量（384d number[]），异步生成后传入 */
  embedding?: number[];
}

/**
 * MemoryStore —— 内存级记忆存储 + better-sqlite3 持久化（Facade）。
 *
 * @contract 模块边界契约（久岐忍 P1-5：模块边界缺少显式契约化定义 → 已闭合）
 *
 * @depends  memory/persistence.ts（SQLite 持久化，WAL 模式，write-through）
 * @depends  memory/storage.ts（Map 内存存储 + 反序列化 + peek 冻结副本）
 * @depends  memory/lifecycle.ts（四态状态机 CAS + archive/freeze/obliterate）
 * @depends  memory/query.ts（内存扫描 + BFS 图遍历 + 向量召回）
 * @depends  @cortex/shared（MemoryEntry, MemoryState, MemoryQuery, LinkType 等类型）
 * @dataflow write(input) → MemoryStorage.insert → MemoryPersistence.run (write-through)
 *          → scheduleFlush (防抖) → flush (WAL checkpoint)
 *          read(query) → MemoryQueryEngine.memScanRead/vectorRecall/bfsExpand
 *          → 排序+限量 → MemoryEntry[]
 *          异常路径：DB 失败回滚内存（假阳性禁止），SQL 失败退化至内存扫描
 *
 *   ┌─ MemoryStore (Facade) ────────────────────────────────────┐
 *   │  write()/read()/link()/cas()/archive()/freeze()/obliterate() │
 *   │  init()/close()/flush()                                     │
 *   ├───────────────────────────────────────────────────────────┤
 *   │  ┌─ MemoryStorage ──────┐  ┌─ MemoryPersistence ──────┐   │
 *   │  │ Map 内存存储          │  │ SQLite WAL 持久化         │   │
 *   │  │ insert/delete/get     │  │ init/close/run/runBatch   │   │
 *   │  │ peek (冻结副本)       │  │ sqlRead/flush/scheduleFlush│  │
 *   │  │ deserializeRow        │  │ updateAccessTracking      │   │
 *   │  └──────────────────────┘  └───────────────────────────┘   │
 *   │  ┌─ MemoryLifecycle ────┐  ┌─ MemoryQueryEngine ──────┐   │
 *   │  │ 四态状态机 CAS        │  │ 内存扫描 + BFS 图遍历     │   │
 *   │  │ archive/freeze/       │  │ 向量召回                  │   │
 *   │  │ obliterate            │  │                           │   │
 *   │  └──────────────────────┘  └───────────────────────────┘   │
 *   └───────────────────────────────────────────────────────────┘
 *
 * 委托组件：
 * - MemoryStorage    —— Map 存储 + 反序列化
 * - MemoryPersistence —— SQLite 持久化（WAL 模式）
 * - MemoryLifecycle  —— 四态状态机（CAS / archive / freeze / obliterate）
 * - MemoryQueryEngine —— 内存扫描 + BFS 图遍历展开
 *
 * - 不调 init()：纯内存（向后兼容，测试用）
 * - 调 init(dbPath)：SQLite WAL 持久化，实时 write-through，重启不丢
 *
 * 30 天 TTL：标记但不真删。read() 自动过滤过期 ACTIVE 记忆。
 *
 *   异常语义（跨模块契约）：
 *   - write()：DB 失败回滚内存 delete(id)，抛出异常（非静默吞错）
 *   - read()：SQL 查询失败自动退化至内存扫描（MemorySqlDegraded）
 *   - cas()：持久化失败回滚 state（Persist-False-Positive 判例）
 *   - link()：DB 失败回滚内存 pop()
 *   - close()：仅 active 态执行，先 flush 再关闭
 */
export class MemoryStore {
  private _storage: MemoryStorage;
  private _persistence: MemoryPersistence;
  private _lifecycle: MemoryLifecycle;
  private _queryEngine: MemoryQueryEngine;
  private _observer?: PipelineObserver;

  /** 持久化模式版本——变更时需编写迁移逻辑（委托自 schema.ts） */
  static readonly SCHEMA_VERSION = SCHEMA_VERSION;

  constructor(observer?: PipelineObserver) {
    this._observer = observer;
    this._storage = new MemoryStorage(observer);
    this._persistence = new MemoryPersistence(observer);
    this._lifecycle = new MemoryLifecycle();
    this._queryEngine = new MemoryQueryEngine();
  }

  /**
   * 启用 SQLite 持久化。
   * 不调用则纯内存运行。
   */
  async init(dbPath: string): Promise<void> {
    await this._persistence.init(dbPath, this._storage);
  }

  /** 持久化是否已启用 */
  get isPersisted(): boolean {
    return this._persistence.isEnabled;
  }

  // ── 写入 ────────────────────────────────────────

  /** 写入一条记忆。返回生成的 id。 */
  write(input: MemoryWriteInput): string {
    if (this._persistence.lifecycle !== "active") {
      throw new Error(`MemoryStore 已关闭 (状态: ${this._persistence.lifecycle})，拒绝写入`);
    }

    const entry = this._storage.insert(input);
    const id = entry.id;

    if (this._persistence.isEnabled) {
      try {
        this._persistence.run(
          `INSERT INTO memories (id, memory_type, state, content, summary, agent_type, creator_id, created_at, last_accessed_at, access_count, weight, project_fingerprint, metadata, is_private, embedding)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.id,
            entry.memoryType,
            entry.state,
            JSON.stringify(entry.content),
            entry.summary,
            entry.agentType,
            entry.creatorId,
            entry.createdAt,
            entry.lastAccessedAt,
            entry.accessCount,
            entry.weight,
            entry.projectFingerprint ?? null,
            entry.metadata ? JSON.stringify(entry.metadata) : null,
            entry.isPrivate ? 1 : 0,
            entry.embedding ? Buffer.from(new Float32Array(entry.embedding).buffer) : null,
          ],
          "write",
        );
        this._persistence.scheduleFlush();
      } catch (e) {
        // 假阳性禁止原则：DB 失败回滚内存
        this._storage.delete(id);
        throw e;
      }
    }

    return id;
  }

  // ── 读取 ────────────────────────────────────────

  read(query: MemoryQuery): MemoryEntry[] {
    const now = Date.now();

    const mode = query.queryMode ?? 'csa';
    const resolvedBfsDepth = query.bfsDepth ?? (mode === 'hca' ? 1 : 2);
    const resolvedBfsMaxNodes = query.bfsMaxNodes ?? 20;
    const resolvedTrackAccess = query.trackAccess ?? (mode === 'csa');
    const resolvedLimit = query.limit ?? (mode === 'hca' ? 10 : 3);

    // 阶段 1：获取候选集
    let results: MemoryEntry[];
    if (this._persistence.isEnabled) {
      results = this._persistenceRead(query, now);
    } else {
      results = this._queryEngine.memScanRead(this._storage, query, now);
    }

    // 阶段 1.5：向量粗召（仅在 query.queryEmbedding 提供时运行）
    if (query.queryEmbedding && results.length > 0) {
      const topK = query.vectorTopK ?? 50;
      results = this._queryEngine.vectorRecall(query.queryEmbedding, results, topK);
    }

    // 阶段 2：BFS 图遍历
    if (resolvedBfsDepth > 0 && results.length > 0) {
      const resolvedBfsDirection = query.bfsDirection ?? 'outbound';
      results = this._queryEngine.bfsExpand(this._storage, results, resolvedBfsDepth, resolvedBfsMaxNodes, query.linkTypes, resolvedBfsDirection);
    }

    // 阶段 3：访问统计刷新
    if (resolvedTrackAccess) {
      for (const m of results) {
        m.accessCount++;
        m.lastAccessedAt = now;
      }
      if (this._persistence.isEnabled && results.length > 0) {
        // 保存原始值，DB 失败时回滚
        const originalAccessCounts = new Map<string, number>();
        const originalLastAccessed = new Map<string, number>();
        for (const m of results) {
          originalAccessCounts.set(m.id, m.accessCount - 1);
          originalLastAccessed.set(m.id, m.lastAccessedAt);
        }
        try {
          this._persistence.updateAccessTracking(
            results.map((m) => ({ id: m.id, accessCount: m.accessCount, lastAccessedAt: m.lastAccessedAt })),
          );
          void this._persistence.scheduleFlush();
        } catch (e) {
          for (const m of results) {
            m.accessCount = originalAccessCounts.get(m.id) ?? m.accessCount;
            m.lastAccessedAt = originalLastAccessed.get(m.id) ?? m.lastAccessedAt;
          }
          if (this._observer) {
            this._observer.emit({
              type: PipelineEventType.MemoryDbWriteFailed,
              priority: PipelinePriority.CRITICAL,
              payload: { opName: "read.access_tracking", error: String(e).slice(0, 300) },
              timestamp: Date.now(),
              notificationType: "WARNING",
            });
          }
        }
      }
    }

    // 阶段 3.5：时间衰减 weight——越旧的记忆权重越低
    // 衰减公式：weight_new = weight_old * max(0.1, 1 - ageDays / 30)
    // 30 天后记忆降至原始权重的 10%（硬地板），保证老旧记忆不会完全消失
    for (const m of results) {
      const ageDays = (now - m.createdAt) / (1000 * 60 * 60 * 24);
      const decayFactor = Math.max(0.1, 1 - ageDays / 30);
      m.weight = +(m.weight * decayFactor).toFixed(4);
    }

    // 阶段 4：排序 + 限量
    results.sort((a, b) => b.weight - a.weight);
    if (resolvedLimit > 0) {
      results = results.slice(0, resolvedLimit);
    }

    return results;
  }

  // ── 关联 ────────────────────────────────────────

  link(sourceId: string, targetId: string, linkType: LinkType, _creatorId: string): MemoryLink | null {
    const source = this._storage.memories.get(sourceId);
    const target = this._storage.memories.get(targetId);
    if (!source || !target) return null;
    if (source.state === MemoryState.Obliterated || target.state === MemoryState.Obliterated) return null;

    let existing = this._storage.links.get(sourceId);
    if (!existing) {
      existing = [];
      this._storage.links.set(sourceId, existing);
    }

    // 幂等去重
    if (linkType !== LinkType.AccessedDuring) {
      if (existing.some((l) => l.targetId === targetId && l.linkType === linkType)) {
        return null;
      }
    }

    const now = Date.now();
    const link: MemoryLink = {
      id: `link-${crypto.randomUUID()}`,
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
          `INSERT INTO links (id, source_id, target_id, link_type, weight, target_state, last_accessed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [link.id, link.sourceId, link.targetId, link.linkType, link.weight, link.targetState, link.lastAccessedAt],
          "link",
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

  // ── 四态状态机 ────────────────────────────────

  has(memoryId: string): boolean {
    return this._storage.memories.has(memoryId);
  }

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

  peek(memoryId: string): Readonly<MemoryEntry> | undefined {
    return this._storage.peek(memoryId);
  }

  get size(): number {
    return this._storage.size;
  }

  async flush(): Promise<void> {
    await this._persistence.flush();
  }

  async close(): Promise<void> {
    await this._persistence.close();
  }

  // ── 内部：持久化回调工厂  ─────────────────────

  /** 生成状态变更持久化回调（供 MemoryLifecycle 使用） */
  private _statePersistFn(opName: string): ((id: string, state: MemoryState) => void) | undefined {
    if (!this._persistence.isEnabled) return undefined;
    return (id: string, state: MemoryState) => {
      this._persistence.run("UPDATE memories SET state = ? WHERE id = ?", [state, id], opName);
      void this._persistence.scheduleFlush();
    };
  }

  // ── 内部：查询委托 ─────────────────────────────

  /** 通过 Persistence 层 SQL 查询，反序列化为 MemoryEntry[] */
  private _persistenceRead(query: MemoryQuery, now: number): MemoryEntry[] {
    try {
      const rawRows = this._persistence.sqlRead(query, now);
      const rows: MemoryEntry[] = [];
      for (const raw of rawRows) {
        const entry = this._storage.deserializeRow(raw);
        if (entry) rows.push(entry);
      }
      // metadata 过滤（SQL 层不做 JSON 子串匹配）
      if (query.metadataFilter && Object.keys(query.metadataFilter).length > 0) {
        return rows.filter((m) => {
          if (!m.metadata) return false;
          return Object.entries(query.metadataFilter!).every(
            ([k, v]) => m.metadata![k] === v,
          );
        });
      }
      return rows;
    } catch (e) {
      // SQL 出错时退回内存扫描
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemorySqlDegraded,
          priority: PipelinePriority.HIGH,
          payload: { error: String(e).slice(0, 200) },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.warn(`[MemoryStore] SQL 查询退化至内存扫描: ${String(e).slice(0, 200)}`);
      }
      return this._queryEngine.memScanRead(this._storage, query, now);
    }
  }

}
