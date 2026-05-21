import type { MemoryQuery, MemoryLink, MemoryState, MemoryType, AgentType } from "@cortex/shared";
import { LinkType, PipelineEventType, PipelinePriority } from "@cortex/shared";
import type { PipelineObserver } from "../core/pipeline-observer.js";
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

  /** 标记生命周期为 closing（由 MemoryStore 调用） */
  markClosing(): void {
    if (this._lifecycle === "active") this._lifecycle = "closing";
  }

  /** 持久化是否已启用 */
  get isEnabled(): boolean {
    return this._persistEnabled;
  }

  /** 暴露给 MemoryStore 的原始 db 引用（谨慎使用） */
  get db(): DatabaseType | undefined {
    return this._db;
  }

  // ─── 生命周期 ─────────────────────────────────────────────

  /**
   * 初始化持久化层：打开/创建 DB 文件、建表、加载存量数据。
   *
   * @fix D4 — 入口检查 _db 是否已存在，防止重复 init() 导致 DB 连接泄漏
   */
  async init(dbPath: string, storage: MemoryStorage): Promise<void> {
    if (this._db) {
      throw new Error(
        `MemoryPersistence already initialized (dbPath: ${this._dbPath}); call close() first`,
      );
    }

    this._dbPath = dbPath;

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this._db = new Database(dbPath);
    this._db.pragma("journal_mode = WAL");

    // 建表 + 加载存量数据
    this._createTables(storage);
    this._persistEnabled = true;
  }

  /**
   * 关闭持久化层：取消待刷写定时器 → 立即刷写 → 关闭 DB 连接。
   *
   * 保证在 DB 关闭前所有脏数据已落盘。
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

  // ─── 写入 ────────────────────────────────────────────────

  /**
   * 单条写入（write-through）。
   *
   * 异常时通过 observer / console.error 上报，然后 rethrow。
   * 调用方（MemoryStore）负责在 DB 失败时回滚内存状态——假阳性禁止。
   */
  run(sql: string, params: unknown[], opName: string): void {
    if (!this._db) {
      throw new Error(`[MemoryPersistence] DB 未初始化，拒绝写入 (op: ${opName})。调用方应检查 isEnabled 或 init() 后调用。`);
    }
    if (this._lifecycle !== "active") {
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryFlushSkipped,
          priority: PipelinePriority.HIGH,
          payload: {
            source: "MemoryPersistence",
            detail: `run() 跳过 (lifecycle=${this._lifecycle})：${opName}`,
          },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.warn(`[MemoryPersistence] run() 跳过 (lifecycle=${this._lifecycle})：${opName}`);
      }
      throw new Error(`[MemoryPersistence] 生命周期非 active（${this._lifecycle}），拒绝写入 (op: ${opName})`);
    }

    try {
      this._db.prepare(sql).run(...(params as unknown[]));
    } catch (e) {
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryDbWriteFailed,
          priority: PipelinePriority.CRITICAL,
          payload: {
            source: "MemoryPersistence",
            operation: opName,
            error: e instanceof Error ? e.message : String(e),
          },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.error(`[MemoryPersistence] ${opName} 失败:`, e);
      }
      throw e;
    }
  }

  /**
   * 批量写入（使用 better-sqlite3 transaction API）。
   *
   * @fix M2 — 使用真实 transaction 而非逐条 prepare/run
   */
  runBatch(sql: string, rows: Array<(string | number | null)[]>, opName: string): void {
    if (!this._db) {
      throw new Error(`[MemoryPersistence] DB 未初始化，拒绝批量写入 (op: ${opName})。调用方应检查 isEnabled 或 init() 后调用。`);
    }
    if (this._lifecycle !== "active") {
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryFlushSkipped,
          priority: PipelinePriority.HIGH,
          payload: {
            source: "MemoryPersistence",
            detail: `runBatch() 跳过 (lifecycle=${this._lifecycle})：${opName}`,
          },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.warn(`[MemoryPersistence] runBatch() 跳过 (lifecycle=${this._lifecycle})：${opName}`);
      }
      throw new Error(`[MemoryPersistence] 生命周期非 active（${this._lifecycle}），拒绝批量写入 (op: ${opName})`);
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
          priority: PipelinePriority.CRITICAL,
          payload: {
            source: "MemoryPersistence",
            operation: opName,
            error: e instanceof Error ? e.message : String(e),
          },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.error(`[MemoryPersistence] ${opName} 批量写入失败:`, e);
      }
      throw e;
    }
  }

  // ─── 刷写 ────────────────────────────────────────────────

  /**
   * 调度一次防抖刷写。
   *
   * 防抖窗口 = _flushDebounceMs（正常）或 _flushDebounceMs × 2^failStreak（指数退避）。
   */
  scheduleFlush(): void {
    if (this._lifecycle !== "active") {
      if (this._dirty && this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryFlushSkipped,
          priority: PipelinePriority.HIGH,
          payload: {
            source: "MemoryPersistence",
            detail: `scheduleFlush() 跳过 (lifecycle=${this._lifecycle})，脏数据未落盘`,
          },
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
        ? this._flushDebounceMs * Math.pow(2, Math.min(this._flushFailStreak, MAX_FLUSH_FAIL_STREAK))
        : this._flushDebounceMs;

    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flushing = true;
      void this.flush().finally(() => {
        this._flushing = false;
        // @fix ADR-02 — flush 完成后若仍有脏数据（flush 期间新写入产生），
        //   自动重新调度下次 flush，防止脏数据无限期滞留内存。
        if (this._dirty) {
          this.scheduleFlush();
        }
      });
    }, delay);
  }

  /**
   * 立即刷写：执行 WAL checkpoint 并清除脏标记。
   *
   * @fix M8 — 即使 wal_checkpoint 失败也清除 _dirty，避免脏标记死锁
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
      this._flushFailStreak = Math.min(this._flushFailStreak + 1, MAX_FLUSH_FAIL_STREAK);
      const errMsg = `[MemoryPersistence] flush() WAL checkpoint 失败 (第${this._flushFailStreak}次): ${e instanceof Error ? e.message : String(e)}`;
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemoryPersistFailed,
          priority: PipelinePriority.CRITICAL,
          payload: {
            source: "MemoryPersistence",
            detail: errMsg,
          },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.error(errMsg);
      }
      // @fix M8 — 失败也清除脏标记，防止死锁
      this._dirty = false;
      throw e;
    }
  }

  // ─── 建表 ────────────────────────────────────────────────

  /**
   * 创建核心表（memories / links / __meta）及索引。
   * 从 SQLite 加载存量数据到 MemoryStorage。
   */
  private _createTables(storage: MemoryStorage): void {
    if (!this._db) return;
    const db = this._db;

    const runSQL = (sql: string, opName: string) => {
      try {
        db.prepare(sql).run();
      } catch (e) {
        console.error(`[MemoryPersistence] ${opName} 建表失败:`, e);
        throw e;
      }
    };

    // memories 表
    runSQL(
      `CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'ACTIVE',
        memory_type TEXT NOT NULL DEFAULT 'EPISODIC',
        sub_type TEXT,
        agent_type TEXT,
        summary TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        embedding BLOB,
        weight REAL NOT NULL DEFAULT 1.0,
        creator_id TEXT,
        is_private INTEGER NOT NULL DEFAULT 0,
        access_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        metadata TEXT,
        project_fingerprint TEXT,
        archived_at INTEGER,
        frozen_at INTEGER,
        expires_at INTEGER
      )`,
      "create_tables.memories",
    );

    // links 表
    runSQL(
      `CREATE TABLE IF NOT EXISTS links (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        link_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        target_state TEXT NOT NULL DEFAULT 'ACTIVE',
        last_accessed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      )`,
      "create_tables.links",
    );

    runSQL(
      "CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id)",
      "create_tables.links_index_source",
    );
    runSQL(
      "CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id)",
      "create_tables.links_index_target",
    );

    // 读取模式版本（首次启动时 __meta 表可能无数据，属正常）
    try {
      const metaRow = db.prepare("SELECT value FROM __meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
      if (metaRow) {
        const storedVer = Number(metaRow.value);
        if (storedVer < SCHEMA_VERSION) {
          console.warn(
            `[MemoryPersistence] schema_version 不匹配：存储=${storedVer}，期望=${SCHEMA_VERSION}。`,
          );
          // 尝试 v1→v2 兼容迁移：添加 links 表缺失列
          if (storedVer === 1 && SCHEMA_VERSION === 2) {
            try {
              db.prepare("ALTER TABLE links ADD COLUMN last_accessed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)").run();
              console.log("[MemoryPersistence] links 表已迁移：添加 last_accessed_at 列");
            } catch (alterErr) {
              // 列可能已存在（CREATE TABLE IF NOT EXISTS 已包含），安全忽略
              if (this._observer) {
                this._observer.emit({
                  type: PipelineEventType.MemorySqlDegraded,
                  priority: PipelinePriority.NORMAL,
                  payload: {
                    source: "MemoryPersistence",
                    detail: `links 表迁移跳过: ${alterErr instanceof Error ? alterErr.message : String(alterErr)}`,
                  },
                  timestamp: Date.now(),
                });
              }
            }
          }
          // 更新 schema_version
          db.prepare("INSERT OR REPLACE INTO __meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
        }
      } else {
        // __meta 表存在但无 schema_version 记录 — 旧 DB，写当前版本号
        db.prepare("INSERT OR REPLACE INTO __meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
      }
    } catch (e) {
      // __meta 表尚未创建（首次运行时），属正常预期行为
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.MemorySqlDegraded,
          priority: PipelinePriority.NORMAL,
          payload: {
            source: "MemoryPersistence",
            detail: "首次启动：__meta 表不存在，schema_version 检查跳过",
          },
          timestamp: Date.now(),
        });
      }
    }

    // ── Column-level migration：旧 DB 可能缺列，逐一检查并 ALTER ──
    const ensureColumn = (table: string, col: string, colDef: string) => {
      try {
        const exists = db.prepare(
          `SELECT COUNT(*) as cnt FROM pragma_table_info('${table}') WHERE name = '${col}'`
        ).get() as { cnt: number } | undefined;
        if (!exists || exists.cnt === 0) {
          db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${colDef}`).run();
          console.log(`[MemoryPersistence] ${table} 表已迁移：添加 ${col} 列`);
        }
      } catch (alterErr) {
        // 列可能已存在，安全忽略
      }
    };
    ensureColumn("memories", "updated_at", "INTEGER NOT NULL DEFAULT (unixepoch() * 1000)");
    ensureColumn("memories", "sub_type", "TEXT");
    ensureColumn("memories", "creator_id", "TEXT");
    ensureColumn("memories", "access_count", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn("memories", "metadata", "TEXT");
    ensureColumn("memories", "project_fingerprint", "TEXT");
    ensureColumn("memories", "archived_at", "INTEGER");
    ensureColumn("memories", "frozen_at", "INTEGER");
    ensureColumn("memories", "expires_at", "INTEGER");

    // 从 SQLite 加载存量数据到 MemoryStorage
    const memRows = db.prepare("SELECT * FROM memories").all() as Record<string, unknown>[];
    for (const raw of memRows) {
      const entry = storage.deserializeRow(raw);
      if (!entry) continue;
      storage.memories.set(entry.id, entry);
    }

    const linkRows = db.prepare("SELECT * FROM links").all() as Record<string, unknown>[];
    for (const raw of linkRows) {
      const link: MemoryLink = {
        id: String(raw.id),
        sourceId: String(raw.source_id),
        targetId: String(raw.target_id),
        linkType: String(raw.link_type) as LinkType,
        weight: Number(raw.weight),
        targetState: String(raw.target_state) as MemoryState,
        lastAccessedAt: Number(raw.last_accessed_at ?? raw.created_at),
      };
      storage.addLink(link.sourceId, link);
    }
  }

  // ─── 查询 ────────────────────────────────────────────────

  /**
   * SQL 查询（仅返回原始行，反序列化由调用方负责）。
   *
   * 若 DB 未初始化或查询失败，返回空数组（降级至内存扫描）。
   *
   * @fix IN 子句分片 — SQLite SQLITE_MAX_EXPR_DEPTH 默认 1000，
   *  大数组的 IN (?,?,...) 会因 OR 展开导致表达式树过深。
   *  将超过 50 个值的 IN 子句拆为多段 OR，每段 ≤ 50 个占位符。
   */
  sqlRead(query: MemoryQuery, now: number): Record<string, unknown>[] {
    if (!this._db) return [];

    const MAX_IN = 50; // 每个 IN 子句最多 50 个值
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    // ── 辅助：安全 IN 子句构建（自动分片）──
    const safeIn = (col: string, values: string[]): void => {
      if (values.length === 0) return;
      if (values.length <= MAX_IN) {
        clauses.push(`${col} IN (${values.map(() => "?").join(",")})`);
        params.push(...values);
      } else {
        // 分片: col IN (50个) OR col IN (50个) OR ...
        const chunks: string[] = [];
        for (let i = 0; i < values.length; i += MAX_IN) {
          const chunk = values.slice(i, i + MAX_IN);
          chunks.push(`${col} IN (${chunk.map(() => "?").join(",")})`);
          params.push(...chunk);
        }
        clauses.push(`(${chunks.join(" OR ")})`);
      }
    };

    // 状态
    if (query.states && query.states.length > 0) {
      safeIn("state", query.states);
    } else {
      clauses.push("state = ?");
      params.push("ACTIVE");
    }

    // 时效衰减：只返回 30 天内的记忆
    const cutoff = now - THIRTY_DAYS_MS;
    clauses.push("created_at > ?");
    params.push(cutoff);

    // 隐私
    if (!query.includePrivate) {
      clauses.push("is_private = 0");
    }

    // 记忆类型
    if (query.memoryTypes && query.memoryTypes.length > 0) {
      safeIn("memory_type", query.memoryTypes);
    }

    // Agent 类型
    if (query.agentTypes && query.agentTypes.length > 0) {
      safeIn("agent_type", query.agentTypes);
    }

    // 时间范围
    if (query.timeRange) {
      clauses.push("created_at >= ? AND created_at <= ?");
      params.push(query.timeRange.start, query.timeRange.end);
    }

    // 子类型
    if (query.subTypes && query.subTypes.length > 0) {
      safeIn("sub_type", query.subTypes);
    }

    // 关键词（每词 2 LIKE，关键词数也限制）
    if (query.keywords && query.keywords.length > 0) {
      const kwLimit = Math.min(query.keywords.length, 50); // 最多 50 个关键词
      for (let i = 0; i < kwLimit; i++) {
        const kw = query.keywords[i];
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
          type: PipelineEventType.MemorySqlDegraded,
          priority: PipelinePriority.NORMAL,
          payload: {
            source: "MemoryPersistence",
            detail: `sqlRead 查询失败: ${e instanceof Error ? e.message : String(e)}`,
          },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.error("[MemoryPersistence] sqlRead 查询失败:", e);
      }
      throw e;
    }
  }

  // ─── 访问追踪 ────────────────────────────────────────────

  /**
   * 批量更新访问计数（使用 transaction API 确保原子性）。
   */
  updateAccessTracking(updates: Array<{ id: string; accessCount: number; lastAccessedAt: number }>): void {
    if (!this._db) return;
    const stmt = this._db.prepare(
      "UPDATE memories SET access_count = ?, last_accessed_at = ? WHERE id = ?",
    );
    const batchUpdate = this._db.transaction((rows: typeof updates) => {
      for (const row of rows) {
        stmt.run(row.accessCount, row.lastAccessedAt, row.id);
      }
    });
    batchUpdate(updates);
  }
}
