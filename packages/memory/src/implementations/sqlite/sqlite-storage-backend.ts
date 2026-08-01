// ============================================================
// @cortex/memory — SqliteStorageBackend SQLite 持久化实现
//
// 基于 AbstractMemoryStore 抽象基类，注入 SQLite 后端：
//   - WAL 模式（读写并发 + 崩溃安全）
//   - FTS5 全文检索（external content，summary/semantic_gist/content_blob）
//   - 防抖刷写（事务批量 upsert，避免高频逐条 fsync）
//   - 写重试（SQLITE_BUSY/LOCKED 指数退避，最多 3 次）
//   - 独立迁移管线（SqliteMigrations，PRAGMA user_version 追踪）
//
// 动态 import better-sqlite3（notification/persistence.ts 先例）：
// 原生依赖加载失败时抛 PersistenceError 而非静默 NOOP——SQLite 是
// 引擎默认持久化后端，不可用必须显式暴露（spec S2-1 原则）。
// ============================================================

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { MemoryEntry, MemoryLink, LinkType } from "@cortex/shared";
import { PersistenceError } from "../../errors/MemoryStoreError.js";
import { AbstractMemoryStore, type MemoryStoreBackend } from "../AbstractMemoryStore.js";
import { migrateSqlite, type MigratableDb } from "./sqlite-migrations.js";

// ── better-sqlite3 最小接口（结构类型，保持动态加载降级能力）──

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(sql: string): unknown;
  close(): void;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
}

/** memories 表行映射 */
interface MemoryRow {
  id: string;
  source: string;
  domain: string | null;
  session_id: string | null;
  kind: string;
  is_fact: number;
  summary: string;
  semantic_gist: string;
  content_blob: string;
  semantic_state: string;
  weight: number;
  access_count: number;
  last_accessed_at: number;
  created_at: number;
  content_hash: string;
  expires_at: number | null;
  embedding: string | null;
}

/** memory_links 表行映射 */
interface LinkRow {
  source_id: string;
  target_id: string;
  link_type: string;
  weight: number;
  created_at: number;
}

/** 写操作重试配置 */
interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
}

const DEFAULT_RETRY: RetryConfig = { maxAttempts: 3, baseDelayMs: 50 };

/** SQLITE_BUSY / SQLITE_LOCKED——并发写冲突，值得重试 */
const RETRYABLE_CODES = new Set([5 /* SQLITE_BUSY */, 6 /* SQLITE_LOCKED */]);

// ── SQLite 后端 ───────────────────────────────────

class SqliteBackend implements MemoryStoreBackend {
  private db: SqliteDatabase | null = null;
  private dbPath = "";
  private readonly retry: RetryConfig;
  /** 是否在 write/set/delete 后立即刷索引（供 SqliteMemoryStore 覆写使用） */
  readonly autoFlush: boolean;

  constructor(options: SqliteStorageBackendOptions) {
    this.retry = options.retry ?? DEFAULT_RETRY;
    this.autoFlush = options.autoFlush !== false;
  }

  /** 数据库是否可用（init 成功后为 true） */
  get available(): boolean {
    return this.db !== null;
  }

  async init(dbPath: string): Promise<void> {
    const resolved = path.resolve(dbPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    try {
      // 动态加载 better-sqlite3——原生依赖不可用必须显式失败（非静默降级）
      const mod = await import("better-sqlite3");
      const Database = mod.default ?? mod;
      const db = new Database(resolved) as SqliteDatabase;
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      db.pragma("busy_timeout = 5000");
      // 迁移管线（幂等：PRAGMA user_version 追踪）
      migrateSqlite(db as unknown as MigratableDb);
      this.db = db;
      this.dbPath = resolved;
    } catch (err) {
      throw new PersistenceError(
        `SQLite 初始化失败（${resolved}）: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async load(store: AbstractMemoryStore): Promise<void> {
    const db = this._requireDb();
    const rows = db.prepare("SELECT * FROM memories").all() as MemoryRow[];
    for (const row of rows) {
      store._loadEntry(row.id, this._rowToEntry(row));
    }
    const linkRows = db.prepare("SELECT * FROM memory_links").all() as LinkRow[];
    const grouped = new Map<string, MemoryLink[]>();
    for (const lr of linkRows) {
      const links = grouped.get(lr.source_id) ?? [];
      links.push({
        id: `${lr.source_id}:${lr.target_id}:${lr.link_type}`,
        sourceId: lr.source_id,
        targetId: lr.target_id,
        linkType: lr.link_type as LinkType,
        weight: lr.weight,
        targetState: "Active" as MemoryLink["targetState"],
        lastAccessedAt: lr.created_at,
      });
      grouped.set(lr.source_id, links);
    }
    for (const [sourceId, links] of grouped) {
      store._loadLinks(sourceId, links);
    }
  }

  async persist(entry: MemoryEntry): Promise<void> {
    await this._withRetry(() => {
      const db = this._requireDb();
      this._upsertEntry(db, entry);
      this._syncFts(db, entry.id);
    }, `persist ${entry.id}`);
  }

  async remove(id: string): Promise<void> {
    await this._withRetry(() => {
      const db = this._requireDb();
      const row = db.prepare("SELECT rowid FROM memories WHERE id = ?").get(id) as { rowid: number } | undefined;
      db.prepare("DELETE FROM memories WHERE id = ?").run(id);
      db.prepare("DELETE FROM memory_links WHERE source_id = ? OR target_id = ?").run(id, id);
      // 独立 FTS5 表：普通 DELETE 幂等（不存在则静默无操作）
      if (row) db.prepare("DELETE FROM memories_fts WHERE rowid = ?").run(row.rowid);
    }, `remove ${id}`);
  }

  async flushIndex(entries: Map<string, MemoryEntry>): Promise<void> {
    if (entries.size === 0) return;
    await this._withRetry(() => {
      const db = this._requireDb();
      const upsert = db.prepare(`
        INSERT INTO memories (
          id, source, domain, session_id, kind, is_fact, summary, semantic_gist,
          content_blob, semantic_state, weight, access_count, last_accessed_at,
          created_at, content_hash, expires_at, embedding, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          summary = excluded.summary,
          semantic_gist = excluded.semantic_gist,
          content_blob = excluded.content_blob,
          semantic_state = excluded.semantic_state,
          weight = excluded.weight,
          access_count = excluded.access_count,
          last_accessed_at = excluded.last_accessed_at,
          content_hash = excluded.content_hash,
          expires_at = excluded.expires_at,
          embedding = excluded.embedding,
          updated_at = excluded.updated_at
      `);
      const syncFts = db.prepare("INSERT INTO memories_fts(rowid, summary, semantic_gist, content_blob) VALUES (?, ?, ?, ?)");
      const rowidStmt = db.prepare("SELECT rowid FROM memories WHERE id = ?");
      // 防抖刷写：单事务批量 upsert（WAL 下减少 checkpoint 频率）
      // rowid 必须取 upsert 后的真实值——TEXT 主键表的 rowid 由 SQLite 分配，
      // 预测值与实际可能不一致（空洞重用/并发），FTS 指向错行即 CORRUPT_VTAB
      const tx = db.transaction((entries: MemoryEntry[]) => {
        for (const entry of entries) {
          this._bindUpsert(upsert, entry);
          const row = rowidStmt.get(entry.id) as { rowid: number } | undefined;
          if (row) {
            this._syncFtsRow(db, syncFts, row.rowid, entry.summary, entry.semantic_gist, JSON.stringify(entry.content_blob));
          }
        }
      });
      tx([...entries.values()]);
    }, "flushIndex");
  }

  async flushLinks(links: Map<string, MemoryLink[]>): Promise<void> {
    await this._withRetry(() => {
      const db = this._requireDb();
      const del = db.prepare("DELETE FROM memory_links WHERE source_id = ?");
      const ins = db.prepare(
        "INSERT OR REPLACE INTO memory_links (source_id, target_id, link_type, weight, created_at) VALUES (?, ?, ?, ?, ?)",
      );
      const tx = db.transaction((all: Array<{ sourceId: string; links: MemoryLink[] }>) => {
        for (const { sourceId, links: linkList } of all) {
          del.run(sourceId);
          for (const l of linkList) {
            ins.run(l.sourceId, l.targetId, l.linkType, l.weight ?? 1, Date.now());
          }
        }
      });
      tx([...links.entries()].map(([sourceId, linkList]) => ({ sourceId, links: linkList })));
    }, "flushLinks");
  }

  async flushAll(entries: Map<string, MemoryEntry>, links: Map<string, MemoryLink[]>): Promise<void> {
    await this.flushIndex(entries);
    await this.flushLinks(links);
  }

  /** 关闭数据库连接（better-sqlite3 close 前自动 checkpoint WAL） */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ── FTS5 检索（可选能力，供 SqliteMemoryStore.searchFts 委托）──

  searchFts(query: string, limit: number): MemoryEntry[] {
    const db = this._requireDb();
    // FTS5 MATCH 语法：用户输入按短语处理（引号包裹），避免语法注入
    const safeQuery = `"${query.replace(/"/g, '""')}"`;
    const rows = db.prepare(`
      SELECT m.* FROM memories_fts f
      JOIN memories m ON m.rowid = f.rowid
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(safeQuery, limit) as MemoryRow[];
    return rows.map((r) => this._rowToEntry(r));
  }

  // ── 私有 ────────────────────────────────────────

  private _requireDb(): SqliteDatabase {
    if (!this.db) {
      throw new PersistenceError("SQLite 后端未初始化——请先调用 init(dbPath)");
    }
    return this.db;
  }

  /** 写操作重试：捕获可重试错误（BUSY/LOCKED）指数退避，其余错误直接抛出 */
  private async _withRetry(fn: () => void, op: string): Promise<void> {
    let attempt = 0;
    for (;;) {
      try {
        fn();
        return;
      } catch (err) {
        const code = (err as { code?: number | string })?.code;
        const retryable = typeof code === "number" && RETRYABLE_CODES.has(code);
        attempt += 1;
        if (!retryable || attempt >= this.retry.maxAttempts) {
          throw new PersistenceError(
            `SQLite 写入失败（${op}）: ${err instanceof Error ? err.message : String(err)}`,
            err instanceof Error ? err : undefined,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, this.retry.baseDelayMs * 2 ** (attempt - 1)));
      }
    }
  }

  private _upsertEntry(db: SqliteDatabase, entry: MemoryEntry): void {
    const stmt = db.prepare(`
      INSERT INTO memories (
        id, source, domain, session_id, kind, is_fact, summary, semantic_gist,
        content_blob, semantic_state, weight, access_count, last_accessed_at,
        created_at, content_hash, expires_at, embedding, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        summary = excluded.summary,
        semantic_gist = excluded.semantic_gist,
        content_blob = excluded.content_blob,
        semantic_state = excluded.semantic_state,
        weight = excluded.weight,
        access_count = excluded.access_count,
        last_accessed_at = excluded.last_accessed_at,
        content_hash = excluded.content_hash,
        expires_at = excluded.expires_at,
        embedding = excluded.embedding,
        updated_at = excluded.updated_at
    `);
    this._bindUpsert(stmt, entry);
  }

  private _bindUpsert(stmt: SqliteStatement, entry: MemoryEntry): void {
    stmt.run(
      entry.id,
      // better-sqlite3 v12+ 不再自动序列化对象——source 为对象结构，显式 JSON
      JSON.stringify(entry.source),
      entry.domain ?? "general",
      entry.sessionId ?? null,
      entry.kind,
      entry.isFact === false ? 0 : 1,
      entry.summary,
      entry.semantic_gist,
      JSON.stringify(entry.content_blob),
      entry.semantic_state,
      entry.weight ?? 0,
      entry.accessCount ?? 0,
      entry.lastAccessedAt ?? 0,
      entry.createdAt,
      entry.content_hash ?? "",
      entry.expires_at ?? null,
      entry.embedding ? JSON.stringify(entry.embedding) : null,
      Date.now(),
    );
  }

  /** FTS5 同步（external content 模式：先 delete 再 insert，兼容更新路径） */
  private _syncFts(db: SqliteDatabase, entryId: string): void {
    const existing = db.prepare("SELECT rowid FROM memories WHERE id = ?").get(entryId) as { rowid: number } | undefined;
    if (!existing) return;
    const entry = db.prepare("SELECT * FROM memories WHERE id = ?").get(entryId) as MemoryRow;
    const fts = db.prepare("INSERT INTO memories_fts(rowid, summary, semantic_gist, content_blob) VALUES (?, ?, ?, ?)");
    this._syncFtsRow(db, fts, existing.rowid, entry.summary, entry.semantic_gist, entry.content_blob);
  }

  /** external content FTS5 行同步：先删除旧行再插入（delete 对不存在行幂等） */
  private _syncFtsRow(
    db: SqliteDatabase,
    insertStmt: SqliteStatement,
    rowid: number,
    summary: string,
    semanticGist: string,
    contentBlob: string,
  ): void {
    // 独立 FTS5 表：普通 DELETE 幂等（不存在则静默无操作，无 CORRUPT 风险）
    db.prepare("DELETE FROM memories_fts WHERE rowid = ?").run(rowid);
    insertStmt.run(rowid, summary, semanticGist, contentBlob);
  }

  private _parseSource(raw: string): MemoryEntry["source"] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") return parsed as MemoryEntry["source"];
    } catch {
      // 兼容旧格式（纯字符串 agentType）——损坏时降级为未知来源
    }
    return { agentType: raw as MemoryEntry["source"]["agentType"], taskId: "" };
  }

  private _rowToEntry(row: MemoryRow): MemoryEntry {
    let contentBlob: Record<string, unknown> = {};
    try {
      contentBlob = JSON.parse(row.content_blob) as Record<string, unknown>;
    } catch {
      // 内容损坏——保留空对象，不阻断加载
    }
    let embedding: number[] | undefined;
    if (row.embedding) {
      try {
        const parsed = JSON.parse(row.embedding) as unknown;
        if (Array.isArray(parsed)) embedding = parsed as number[];
      } catch {
        // 嵌入损坏——降级为无嵌入
      }
    }
    return {
      id: row.id,
      source: this._parseSource(row.source),
      domain: row.domain ?? undefined,
      sessionId: row.session_id ?? undefined,
      kind: row.kind as MemoryEntry["kind"],
      isFact: row.is_fact !== 0,
      summary: row.summary,
      semantic_gist: row.semantic_gist,
      content_blob: contentBlob,
      semantic_state: row.semantic_state as MemoryEntry["semantic_state"],
      weight: row.weight,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      createdAt: row.created_at,
      content_hash: row.content_hash,
      expires_at: row.expires_at ?? undefined,
      embedding,
    };
  }
}

// ── SqliteMemoryStore ─────────────────────────────

/**
 * SqliteMemoryStore —— 基于 SQLite 持久化的 MemoryStore 实现。
 *
 * 继承 AbstractMemoryStore 的全部共享方法，注入 SqliteBackend：
 *   - WAL 模式 + FTS5 全文检索 + 迁移管线
 *   - 默认 autoFlush（write/set/delete 后同步落库）
 *   - searchFts() 暴露 FTS5 中文/多语言检索能力
 */
export class SqliteMemoryStore extends AbstractMemoryStore {
  private readonly _backend: SqliteBackend;

  override get isPersisted(): boolean { return true; }

  constructor(options?: SqliteStorageBackendOptions) {
    const backend = new SqliteBackend(options ?? {});
    super(backend);
    this._backend = backend;
  }

  override async write(input: Parameters<AbstractMemoryStore["write"]>[0]): ReturnType<AbstractMemoryStore["write"]> {
    const id = await super.write(input);
    if (this._backend.autoFlush) await this._backend.flushIndex(this._entries);
    return id;
  }

  override async set(id: string, entry: MemoryEntry): Promise<void> {
    await super.set(id, entry);
    if (this._backend.autoFlush) await this._backend.flushIndex(this._entries);
  }

  override async delete(id: string): Promise<boolean> {
    const result = await super.delete(id);
    if (result && this._backend.autoFlush) {
      await this._backend.flushIndex(this._entries);
      await this._backend.flushLinks(this._links);
    }
    return result;
  }

  override async close(): Promise<void> {
    // AbstractMemoryStore.close() 只做 flushAll + 清空内存，不关闭后端连接——
    // SQLite 句柄必须显式释放，否则 Windows 下 WAL/-shm 文件被占用（EBUSY）
    await super.close();
    await this._backend.close();
  }

  /** FTS5 全文检索（含中文——FTS5 按 token 切分，unicode61 支持 CJK 连续字符匹配） */
  async searchFts(query: string, limit = 10): Promise<MemoryEntry[]> {
    return this._backend.searchFts(query, limit);
  }
}

// ── 公开类型 ──────────────────────────────────────

export interface SqliteStorageBackendOptions {
  /** write/set/delete 后是否立即刷索引（默认 true） */
  autoFlush?: boolean;
  /** 写重试配置（默认 3 次，50ms 指数退避） */
  retry?: RetryConfig;
}

export type { RetryConfig as SqliteRetryConfig };
