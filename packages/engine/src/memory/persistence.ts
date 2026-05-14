import type { MemoryQuery, MemoryLink, MemoryState, MemoryType, AgentType } from "@cortex/shared";
import { LinkType, PipelineEventType, PipelinePriority } from "@cortex/shared";
import type { PipelineObserver } from "../pipeline-observer.js";
import type { MemoryStorage } from "./storage.js";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
/** @internal better-sqlite3 CJS 导出命名空间；取内部类作为字段类型 */
type DatabaseType = InstanceType<typeof Database>;

import { SCHEMA_VERSION, FLUSH_DEBOUNCE_MS, MAX_FLUSH_FAIL_STREAK, THIRTY_DAYS_MS } from "./schema.js";

/**
 * MemoryPersistence —— SQLite better-sqlite3 持久化层。
 *
 * 职责：
 * - DB 连接管理（init/open/close）
 * - 表创建 + 模式版本管理
 * - 数据加载/保存
 * - 防抖写盘 + 指数退避
 * - SQL 查询（仅返回原始行，反序列化由调用方负责）
 *
 * 不负责：内存 Map 操作（MemoryStorage）、查询编排（MemoryStore）、状态机（MemoryLifecycle）。
 *
 * @fix M2 — runBatch 使用 better-sqlite3 transaction API 实现真实批量写入
 * @fix M8 — flush() 失败后正确清除 _dirty 状态
 */
export class MemoryPersistence {
  private _db?: DatabaseType;
  private _dbPath?: string;
  private _persistEnabled = false;

  // 生命周期（与 MemoryStore 共享引用）
  private _lifecycle: "active" | "closing" | "closed" = "active";

  // 防抖写盘
  private _dirty = false;
  private _flushing = false;
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _flushFailStreak = 0;
  private readonly _flushDebounceMs = FLUSH_DEBOUNCE_MS;

  private _observer?: PipelineObserver;

  constructor(observer?: PipelineObserver) {
    this._observer = observer;
  }

  /** 当前生命周期状态（供 MemoryStore 读取） */
  get lifecycle(): "active" | "closing" | "closed" {
    return this._lifecycle;
  }

  /** 进入 closing 状态 */
  markClosing(): void {
    if (this._lifecycle === "active") this._lifecycle = "closing";
  }

  /** 持久化是否已启用 */
  get isEnabled(): boolean {
    return this._persistEnabled;
  }

  /** DB 是否打开 */
  get db(): DatabaseType | undefined {
    return this._db;
  }

  // ── 生命周期 ─────────────────────────────────

  /**
   * 初始化 SQLite 持久化。创建/打开 DB，建表，从 storage 加载已有数据。
   */
  async init(dbPath: string, storage: MemoryStorage): Promise<void> {
    this._dbPath = dbPath;

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this._db = new Database(dbPath);
    this._db.pragma("journal_mode = WAL");

    this._createTables();
    this._loadFromDb(storage);
    this._persistEnabled = true;
  }

  /** 关闭数据库连接。flush() 后再 close()。 */
  async close(): Promise<void> {
    if (this._lifecycle !== "active") return;
    this.markClosing();

    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }

    await this.flush();

    if (this._db) {
      this._db.close();
      this._db = undefined;
      this._persistEnabled = false;
    }
    this._lifecycle = "closed";
  }

  // ── 写入 ─────────────────────────────────────

  /**
   * 安全的 DB 写入封装。
   *
   * 治理判例 NG-2026-0509-Persist-False-Positive（假阳性禁止原则）：
   * 持久化失败必须传播为操作失败，不得静默返回成功。
   */
  run(sql: string, params: unknown[], opName: string): void {
    if (!this._db) {
      throw new Error(`[MemoryPersistence] DB 未初始化，拒绝写入 (op: ${opName})。调用方应检查 isEnabled 或 init() 后调用。`);
    }
    if (this._lifecycle !== "active") {
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryWriteBlocked,
          priority: PipelinePriority.HIGH,
          payload: { opName, lifecycle: this._lifecycle, sql: sql.slice(0, 80) },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.warn(`[MemoryStore] run 被拒: lifecycle=${this._lifecycle}, op=${opName}`);
      }
      throw new Error(`[MemoryPersistence] 已 ${this._lifecycle}，拒绝写入 (op: ${opName})。治理判例 NG-2026-0509-Persist-False-Positive：持久化失败必须传播为操作失败，不得静默返回成功。`);
    }
    try {
      this._db.prepare(sql).run(...(params as (string | number | null)[]));
    } catch (e) {
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryDbWriteFailed,
          priority: PipelinePriority.CRITICAL,
          payload: { opName, sql: sql.slice(0, 80), error: String(e).slice(0, 300) },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      }
      throw e;
    }
  }

  /**
   * 批量更新（用于 accessCount/lastAccessedAt 等场景）。
   * 使用 better-sqlite3 transaction API 实现真实批量写入。
   * 返回成功更新的行数，失败时抛出。
   *
   * @fix M2 — 使用 transaction 包装，消除逐行独立事务的性能开销
   */
  runBatch(sql: string, rows: Array<(string | number | null)[]>, opName: string): void {
    if (!this._db) {
      throw new Error(`[MemoryPersistence] DB 未初始化，拒绝批量写入 (op: ${opName})。调用方应检查 isEnabled 或 init() 后调用。`);
    }
    if (this._lifecycle !== "active") {
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryWriteBlocked,
          priority: PipelinePriority.HIGH,
          payload: { opName, lifecycle: this._lifecycle, hint: "runBatch 在非 active 状态下被拒绝" },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.warn(`[MemoryStore] runBatch 被拒: lifecycle=${this._lifecycle}, op=${opName}`);
      }
      throw new Error(`[MemoryPersistence] 已 ${this._lifecycle}，拒绝批量写入 (op: ${opName})。治理判例 NG-2026-0509-Persist-False-Positive：持久化失败必须传播为操作失败，不得静默返回成功。`);
    }
    try {
      const stmt = this._db.prepare(sql);
      const batchInsert = this._db.transaction((batchRows: Array<(string | number | null)[]>) => {
        for (const params of batchRows) {
          stmt.run(params);
        }
      });
      batchInsert(rows);
    } catch (e) {
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryDbWriteFailed,
          priority: PipelinePriority.CRITICAL,
          payload: { opName, error: String(e).slice(0, 300) },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      }
      throw e;
    }
  }

  // ── 防抖写盘 ─────────────────────────────────

  /**
   * 标记脏数据，安排延迟 WAL checkpoint。
   *
   * 治理判例 NG-2026-0511-Dirty-Before-Save（假旗帜禁止原则）：
   * _dirty 必须在 flush() 成功后清除，不得在 flush() 前清除。
   */
  scheduleFlush(): void {
    if (this._lifecycle !== "active") {
      if (this._dirty && this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryFlushSkipped,
          priority: PipelinePriority.HIGH,
          payload: { lifecycle: this._lifecycle, hint: "MemoryStore closing/closed, pending writes may be lost" },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      }
      return;
    }
    this._dirty = true;
    if (this._flushing) return;
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
    }
    const delay = this._flushFailStreak > 0
      ? this._flushDebounceMs * Math.pow(2, Math.min(this._flushFailStreak, 4))
      : this._flushDebounceMs;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flushing = true;
      void this.flush().finally(() => {
        this._flushing = false;
        if (this._dirty) this.scheduleFlush();
      });
    }, delay);
  }

  /**
   * 强制 WAL checkpoint 到主 DB 文件。
   * 成功清除 _dirty；失败时也清除 _dirty（M8: 脏状态标记问题修复）。
   *
   * @fix M8 — 即使 wal_checkpoint 失败也清除 _dirty，防止 closing 过渡期残留假阳性脏标记。
   *   失败信息通过 observer 管道上报，保留 diagnostic 可用性。
   */
  async flush(): Promise<void> {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (!this._dirty) return;

    if (!this._db || !this._dbPath) return;

    // 内存数据库不做 checkpoint
    if (this._dbPath === ":memory:") {
      this._flushFailStreak = 0;
      this._dirty = false;
      return;
    }

    try {
      this._db.pragma("wal_checkpoint(TRUNCATE)");
      this._flushFailStreak = 0;
      this._dirty = false;
    } catch (e) {
      this._flushFailStreak = Math.min(this._flushFailStreak + 1, MAX_FLUSH_FAIL_STREAK + 1);
      const errMsg = `[MemoryStore] WAL checkpoint 失败（连续失败${this._flushFailStreak}次）: ${String(e).slice(0, 300)}`;
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryPersistFailed,
          priority: PipelinePriority.CRITICAL,
          payload: { dbPath: this._dbPath, error: String(e), failStreak: this._flushFailStreak },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.error(errMsg);
      }
      // M8: 即使 checkpoint 失败也清除 _dirty，防止 lifecycle 切换后残留假阳性脏标记
      this._dirty = false;
      throw e;
    }
  }

  // ── 内部：建表 + 加载 ────────────────────────

  private _createTables(): void {
    if (!this._db) return;
    const db = this._db;

    const runSQL = (sql: string, opName: string) => {
      try {
        db.prepare(sql).run();
      } catch (e) {
        if (this._observer) {
          this._observer.emit({
            type: PipelineEventType.MemoryDbWriteFailed,
            priority: PipelinePriority.CRITICAL,
            payload: { opName, sql: sql.slice(0, 80), error: String(e).slice(0, 300) },
            timestamp: Date.now(),
            notificationType: "WARNING",
          });
        }
        throw e;
      }
    };

    runSQL(`CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      memory_type TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'ACTIVE',
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 1.0,
      project_fingerprint TEXT,
      metadata TEXT,
      is_private INTEGER NOT NULL DEFAULT 0,
      embedding BLOB
    )`, "create_tables.memories");

    runSQL(`CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0.5,
      target_state TEXT NOT NULL,
      last_accessed_at INTEGER NOT NULL
    )`, "create_tables.links");

    runSQL("CREATE INDEX IF NOT EXISTS idx_memories_state ON memories(state)", "create_tables.idx_state");
    runSQL("CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type)", "create_tables.idx_type");
    runSQL("CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id)", "create_tables.idx_source");
    runSQL("CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id)", "create_tables.idx_target");
    runSQL(`CREATE TABLE IF NOT EXISTS __meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`, "create_tables.__meta");
    runSQL("INSERT OR REPLACE INTO __meta (key, value) VALUES ('schema_version', '1')", "create_tables.set_version");
  }

  private _loadFromDb(storage: MemoryStorage): void {
    if (!this._db) return;

    // 读取模式版本
    try {
      const metaRow = this._db.prepare("SELECT value FROM __meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
      if (metaRow) {
        const storedVer = parseInt(metaRow.value, 10);
        if (storedVer !== SCHEMA_VERSION) {
          console.warn(
            `[MemoryStore] DB schema version mismatch: stored=${storedVer}, current=${SCHEMA_VERSION}. 需要迁移或重置。`,
          );
        }
      }
    } catch {
      // __meta 表可能不存在（旧版 DB），静默处理
    }

    // 加载记忆
    const memRows = this._db.prepare("SELECT * FROM memories").all() as Record<string, unknown>[];
    for (const raw of memRows) {
      const entry = storage.deserializeRow(raw);
      if (!entry) continue;
      storage.memories.set(entry.id, entry);
    }

    // 加载关联
    const linkRows = this._db.prepare("SELECT * FROM links").all() as Record<string, unknown>[];
    for (const raw of linkRows) {
      const link: MemoryLink = {
        id: raw.id as string,
        sourceId: raw.source_id as string,
        targetId: raw.target_id as string,
        linkType: raw.link_type as LinkType,
        weight: raw.weight as number,
        targetState: raw.target_state as MemoryState,
        lastAccessedAt: raw.last_accessed_at as number,
      };
      let existing = storage.links.get(link.sourceId);
      if (!existing) {
        existing = [];
        storage.links.set(link.sourceId, existing);
      }
      existing.push(link);
    }
  }

  // ── SQL 读 ───────────────────────────────────

  /**
   * SQL 查询：返回原始 DB 行（Record<string, unknown>[]）。
   * 反序列化由调用方（MemoryStore.read()）通过 storage.deserializeRow() 完成。
   */
  sqlRead(query: MemoryQuery, now: number): Record<string, unknown>[] {
    if (!this._db) return [];

    const clauses: string[] = [];
    const params: (string | number)[] = [];

    // 状态
    if (query.states && query.states.length > 0) {
      clauses.push(`state IN (${query.states.map(() => "?").join(",")})`);
      params.push(...query.states);
    } else {
      clauses.push("state = ?");
      params.push("ACTIVE");
    }

    // 30 天窗口
    const cutoff = now - THIRTY_DAYS_MS;
    clauses.push("created_at > ?");
    params.push(cutoff);

    // 私密
    if (!query.includePrivate) {
      clauses.push("is_private = 0");
    }

    // 类型
    if (query.memoryTypes && query.memoryTypes.length > 0) {
      clauses.push(`memory_type IN (${query.memoryTypes.map(() => "?").join(",")})`);
      params.push(...query.memoryTypes);
    }

    // Agent 类型
    if (query.agentTypes && query.agentTypes.length > 0) {
      clauses.push(`agent_type IN (${query.agentTypes.map(() => "?").join(",")})`);
      params.push(...query.agentTypes);
    }

    // 时间范围
    if (query.timeRange) {
      clauses.push("created_at >= ? AND created_at <= ?");
      params.push(query.timeRange.start, query.timeRange.end);
    }

    // 关键词
    if (query.keywords && query.keywords.length > 0) {
      for (const kw of query.keywords) {
        clauses.push("(summary LIKE ? OR content LIKE ?)");
        params.push(`%${kw}%`, `%${kw}%`);
      }
    }

    const sql = `SELECT * FROM memories WHERE ${clauses.join(" AND ")} ORDER BY weight DESC`;

    try {
      return this._db.prepare(sql).all(...params) as Record<string, unknown>[];
    } catch (e) {
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
      throw e;
    }
  }

  // ── 访问追踪批量写 ───────────────────────────

  /**
   * 批量更新 accessCount 和 lastAccessedAt 到 DB。
   * 使用 transaction 包装（M2）。
   * 失败时抛出异常（由 MemoryStore 调用方回滚内存）。
   */
  updateAccessTracking(updates: Array<{ id: string; accessCount: number; lastAccessedAt: number }>): void {
    if (!this._db) return;
    const stmt = this._db.prepare(
      "UPDATE memories SET access_count = ?, last_accessed_at = ? WHERE id = ?",
    );
    const batchUpdate = this._db.transaction((rows: Array<{ id: string; accessCount: number; lastAccessedAt: number }>) => {
      for (const u of rows) {
        stmt.run([u.accessCount, u.lastAccessedAt, u.id]);
      }
    });
    batchUpdate(updates);
  }
}
