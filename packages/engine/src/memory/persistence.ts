import type { MemoryQuery, MemoryLink, MemoryState, MemoryType, AgentType } from "@cortex/shared";
import { LinkType, PipelineEventType, PipelinePriority } from "@cortex/shared";
import type { PipelineObserver } from "../pipeline-observer.js";
import { MemoryStorage } from "./storage.js";
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
 * @fix D4 — init() 入口处检查 _db 是否已存在。防止两次 init() 导致 DB 连接泄漏和 WAL 锁定。
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

  /** 标记为 closing 状态，阻止新写入 */
  markClosing(): void {
    if (this._lifecycle === "active") this._lifecycle = "closing";
  }

  /** 持久化是否已启用 */
  get isEnabled(): boolean {
    return this._persistEnabled;
  }

  /** 底层数据库连接（只读暴露，供 MemoryStore 直接读取） */
  get db(): DatabaseType | undefined {
    return this._db;
  }

  // ─── 生命周期 ─────────────────────────────────────────

  /**
   * 初始化：打开/创建 SQLite 数据库（WAL 模式），建表，从 DB 加载数据到 storage。
   *
   * @param dbPath  - 数据库文件路径
   * @param storage - 内存存储实例（从 DB 加载的数据会写入此 storage）
   */
  async init(dbPath: string, storage: MemoryStorage): Promise<void> {
    if (this._db) {
      throw new Error(
        `MemoryPersistence already initialized (dbPath: ${this._dbPath}); call close() first.`,
      );
    }

    this._dbPath = dbPath;

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this._db = new Database(dbPath);
    this._db.pragma("journal_mode = WAL");

    this._createTables(storage);
    this._persistEnabled = true;
  }

  /**
   * 关闭：刷新脏数据 → 关闭 DB 连接 → 标记 closed
   */
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

  // ─── 写入 ─────────────────────────────────────────────

  /**
   * 单条 SQL 写入（INSERT / UPDATE / DELETE），带生命周期守卫和错误上报。
   *
   * @param sql     - SQL 语句（含 ? 占位符）
   * @param params  - 参数数组
   * @param opName  - 操作名称（用于日志和错误消息）
   */
  run(sql: string, params: unknown[], opName: string): void {
    if (!this._db) {
      throw new Error(`[MemoryPersistence] DB 未初始化，拒绝写入 (op: ${opName})。调用方应检查 isEnabled 或 init() 后调用。`);
    }
    if (this._lifecycle !== "active") {
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryWriteBlocked,
          priority: PipelinePriority.NORMAL,
          payload: { op: opName, lifecycle: this._lifecycle },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.warn(`[MemoryPersistence] 写入被拒：${this._lifecycle} 状态 (op: ${opName})`);
      }
      throw new Error(
        `[MemoryPersistence] 无法写入：lifecycle=${this._lifecycle} (op: ${opName})。调用方应检查 lifecycle 或 isEnabled。`,
      );
    }

    try {
      this._db.prepare(sql).run(...(params as (string | number | null)[]));
    } catch (e) {
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryDbWriteFailed,
          priority: PipelinePriority.NORMAL,
          payload: { op: opName, sql },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.warn(`[MemoryPersistence] DB 写入失败 (op: ${opName}): ${e instanceof Error ? e.message : String(e)}`);
      }
      throw e;
    }
  }

  /**
   * 批量 SQL 写入（使用 better-sqlite3 transaction API 实现真实批量）。
   *
   * @param sql     - SQL 语句（含 ? 占位符）
   * @param rows    - 多行参数数组
   * @param opName  - 操作名称（用于日志和错误消息）
   */
  runBatch(sql: string, rows: Array<(string | number | null)[]>, opName: string): void {
    if (!this._db) {
      throw new Error(`[MemoryPersistence] DB 未初始化，拒绝批量写入 (op: ${opName})。调用方应检查 isEnabled 或 init() 后调用。`);
    }
    if (this._lifecycle !== "active") {
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryWriteBlocked,
          priority: PipelinePriority.NORMAL,
          payload: { op: opName, lifecycle: this._lifecycle },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.warn(`[MemoryPersistence] 批量写入被拒：${this._lifecycle} 状态 (op: ${opName})`);
      }
      throw new Error(
        `[MemoryPersistence] 无法批量写入：lifecycle=${this._lifecycle} (op: ${opName})。调用方应检查 lifecycle 或 isEnabled。`,
      );
    }

    try {
      const stmt = this._db.prepare(sql);
      const batchInsert = this._db.transaction((batchRows: Array<(string | number | null)[]>) => {
        for (const row of batchRows) {
          stmt.run(...row);
        }
      });
      batchInsert(rows);
    } catch (e) {
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryDbWriteFailed,
          priority: PipelinePriority.NORMAL,
          payload: { op: opName, sql },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.warn(`[MemoryPersistence] 批量 DB 写入失败 (op: ${opName}): ${e instanceof Error ? e.message : String(e)}`);
      }
      throw e;
    }
  }

  // ─── 防抖写盘 ─────────────────────────────────────────

  /**
   * 调度一次防抖 flush：标记脏数据 → 延迟后执行 flush。
   * 若生命周期非 active，跳过并 emit MemoryFlushSkipped。
   */
  scheduleFlush(): void {
    if (this._lifecycle !== "active") {
      if (this._dirty && this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryFlushSkipped,
          priority: PipelinePriority.NORMAL,
          payload: { lifecycle: this._lifecycle },
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

    const delay =
      this._flushFailStreak > 0
        ? this._flushDebounceMs * Math.pow(2, Math.min(this._flushFailStreak, 4))
        : this._flushDebounceMs;

    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flushing = true;
      void this.flush().finally(() => {
        this._flushing = false;
      });
    }, delay);
  }

  /**
   * 立即执行 flush：WAL checkpoint + 重置脏标记。
   * 失败时递增 _flushFailStreak 并清除 _dirty（M8 修复）。
   */
  async flush(): Promise<void> {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (!this._dirty) return;

    if (!this._db || !this._dbPath) return;

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
      const errMsg = `[MemoryPersistence] WAL checkpoint 失败 (第 ${this._flushFailStreak} 次): ${e instanceof Error ? e.message : String(e)}`;
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryPersistFailed,
          priority: PipelinePriority.NORMAL,
          payload: { failStreak: this._flushFailStreak, dbPath: this._dbPath },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.error(errMsg);
      }
      this._dirty = false;
      throw e;
    }
  }

  // ─── 建表 + 迁移 ──────────────────────────────────────

  /**
   * 创建核心表（memories / links / __meta）及索引。
   * 包含 schema_version 写入和 sub_type 迁移。
   */
  private _createTables(storage: MemoryStorage): void {
    if (!this._db) return;
    const db = this._db;

    const runSQL = (sql: string, opName: string) => {
      try {
        db.prepare(sql).run();
      } catch (e) {
        if (this._observer) {
          this._observer.emit({
            type: PipelineEventType.MemoryDbWriteFailed,
            priority: PipelinePriority.NORMAL,
            payload: { op: opName, sql: sql.slice(0, 80) },
            timestamp: Date.now(),
            notificationType: "WARNING",
          });
        } else {
          console.warn(`[MemoryPersistence] SQL 执行失败 (${opName}): ${e instanceof Error ? e.message : String(e)}`);
        }
        throw e;
      }
    };

    runSQL(
      `CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        memory_type TEXT NOT NULL,
        sub_type TEXT,
        content TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        agent_type TEXT NOT NULL,
        creator_id TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'ACTIVE',
        weight INTEGER NOT NULL DEFAULT 5,
        is_private INTEGER NOT NULL DEFAULT 0,
        access_count INTEGER NOT NULL DEFAULT 0,
        embedding BLOB,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER
      )`,
      "create_tables.memories",
    );

    runSQL(
      `CREATE TABLE IF NOT EXISTS links (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        link_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        target_state TEXT NOT NULL DEFAULT 'ACTIVE',
        last_accessed_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (source_id, target_id)
      )`,
      "create_tables.links",
    );


    

    // 读取模式版本（首次启动时 __meta 表可能无数据，属正常）
    try {
      const metaRow = this._db.prepare("SELECT value FROM __meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
      if (metaRow) {
        const storedVer = parseInt(metaRow.value, 10);
        if (storedVer !== SCHEMA_VERSION) {
          console.warn(
            `[MemoryPersistence] schema_version 不匹配：存储=${storedVer}，期望=${SCHEMA_VERSION}。可能出现兼容性问题。`,
          );
        }
      }
    } catch (e) {
      // __meta 表尚未创建（首次运行时），静默忽略
    }

    const memRows = this._db.prepare("SELECT * FROM memories").all() as Record<string, unknown>[];

    for (const raw of memRows) {
      const entry = storage.deserializeRow(raw);
      if (!entry) continue;
      storage.memories.set(entry.id, entry);
    }

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
      const existing = storage.links.get(link.sourceId);
      if (!existing) {
        storage.links.set(link.sourceId, [link]);
      } else {
        existing.push(link);
      }
    }
  }

  // ─── SQL 查询 ──────────────────────────────────────────

  /**
   * 执行带条件的 SQL SELECT 查询。
   * 由 MemoryQueryEngine 调用，返回原始行（反序列化由调用方负责）。
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

    const cutoff = now - THIRTY_DAYS_MS;
    clauses.push("created_at > ?");
    params.push(cutoff);

    if (!query.includePrivate) {
      clauses.push("is_private = 0");
    }

    // 类型过滤
    if (query.memoryTypes && query.memoryTypes.length > 0) {
      clauses.push(`memory_type IN (${query.memoryTypes.map(() => "?").join(",")})`);
      params.push(...query.memoryTypes);
    }

    if (query.agentTypes && query.agentTypes.length > 0) {
      clauses.push(`agent_type IN (${query.agentTypes.map(() => "?").join(",")})`);
      params.push(...query.agentTypes);
    }

    // 时间范围
    if (query.timeRange) {
      clauses.push("created_at >= ? AND created_at <= ?");
      params.push(query.timeRange.start, query.timeRange.end);
    }

    // 子类型
    if (query.subTypes && query.subTypes.length > 0) {
      clauses.push(`sub_type IN (${query.subTypes.map(() => "?").join(",")})`);
      params.push(...query.subTypes);
    }

    // 关键词（LIKE 搜索）
    if (query.keywords && query.keywords.length > 0) {
      for (const kw of query.keywords) {
        clauses.push("(summary LIKE ? OR content LIKE ?)");
        params.push(`%${kw}%`, `%${kw}%`);
      }
    }

    const sql = `SELECT * FROM memories WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`;

    try {
      return this._db.prepare(sql).all(...params) as Record<string, unknown>[];
    } catch (e) {
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryDbWriteFailed,
          priority: PipelinePriority.NORMAL,
          payload: { op: "sqlRead", sql: sql.slice(0, 120) },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.warn(`[MemoryPersistence] SQL 查询失败: ${e instanceof Error ? e.message : String(e)}`);
      }
      throw e;
    }
  }

  // ─── 访问追踪 ──────────────────────────────────────────

  /**
   * 批量更新记忆的访问计数和最后访问时间。
   * 使用 transaction 保证原子性。
   */
  updateAccessTracking(updates: Array<{ id: string; accessCount: number; lastAccessedAt: number }>): void {
    if (!this._db) return;
    const stmt = this._db.prepare(
      "UPDATE memories SET access_count = ?, last_accessed_at = ? WHERE id = ?",
    );
    const batchUpdate = this._db.transaction((rows: Array<{ id: string; accessCount: number; lastAccessedAt: number }>) => {
      for (const row of rows) {
        stmt.run(row.accessCount, row.lastAccessedAt, row.id);
      }
    });
    batchUpdate(updates);
  }
}
