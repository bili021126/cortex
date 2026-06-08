import { PipelineEventType, PipelinePriority, type IPipelineObserver, type LinkType, type MemoryLink, type MemoryQuery, type SemanticState } from "@cortex/shared";
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

  private _observer?: IPipelineObserver;

  constructor(observer?: IPipelineObserver) {
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
        // @fix P0-4 — 建表失败通过 observer 管道上报，console 仅兜底（原则五）
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
          console.error(`[MemoryPersistence] ${opName} 建表失败:`, e);
        }
        throw e;
      }
    };

    // memories 表 (v3 schema)
    runSQL(
      `CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        semantic_state TEXT NOT NULL DEFAULT 'Active',
        kind TEXT NOT NULL DEFAULT 'TaskLog',
        source TEXT NOT NULL DEFAULT '{}',
        summary TEXT NOT NULL DEFAULT '',
        semantic_gist TEXT NOT NULL DEFAULT '',
        content_blob TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        embedding BLOB,
        weight REAL NOT NULL DEFAULT 1.0,
        access_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        expires_at INTEGER,
        session_id TEXT
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
        target_state TEXT NOT NULL DEFAULT 'Active',
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

    // FTS5 全文索引——从 summary + semantic_gist 生成
    runSQL(
      `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        summary,
        semantic_gist,
        content=memories,
        content_rowid=rowid
      )`,
      "create_tables.fts5",
    );

    // FTS5 同步触发器
    runSQL(
      `CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, summary, semantic_gist) VALUES (new.rowid, new.summary, new.semantic_gist);
      END`,
      "create_tables.fts5_trigger_ai",
    );
    runSQL(
      `CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, summary, semantic_gist) VALUES('delete', old.rowid, old.summary, old.semantic_gist);
      END`,
      "create_tables.fts5_trigger_ad",
    );
    runSQL(
      `CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, summary, semantic_gist) VALUES('delete', old.rowid, old.summary, old.semantic_gist);
        INSERT INTO memories_fts(rowid, summary, semantic_gist) VALUES (new.rowid, new.summary, new.semantic_gist);
      END`,
      "create_tables.fts5_trigger_au",
    );

    // 读取模式版本（首次启动时 __meta 表可能无数据，属正常）
    try {
      const metaRow = db.prepare("SELECT value FROM __meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
      if (metaRow) {
        const storedVer = Number(metaRow.value);
        if (storedVer < SCHEMA_VERSION) {
          if (this._observer) {
            this._observer.emit({
              type: PipelineEventType.MemorySqlDegraded,
              priority: PipelinePriority.NORMAL,
              payload: { source: "MemoryPersistence", detail: `schema_version 不匹配: ${storedVer}->${SCHEMA_VERSION}` },
              timestamp: Date.now(),
            });
          } else {
            console.warn(
              `[MemoryPersistence] schema_version 不匹配：存储=${storedVer}，期望=${SCHEMA_VERSION}。`,
            );
          }
          // v4->v5 迁移：添加新列并映射旧数据
          if (storedVer <= 4 && SCHEMA_VERSION >= 5) {
            try {
              const colNames = db.prepare("SELECT name FROM pragma_table_info('memories')").all() as { name: string }[];
              const hasCol = (name: string) => colNames.some((c) => c.name === name);

              // 新表已创建（含新列），旧表可能还缺列——用 ensureColumn 补
              // 填充 semantic_gist = summary, content_blob = content, semantic_state = state, kind = memory_type, source = agent_type
              if (hasCol("summary") && hasCol("semantic_gist")) {
                db.prepare("UPDATE memories SET semantic_gist = summary WHERE semantic_gist = ''").run();
              }
              if (hasCol("content") && hasCol("content_blob")) {
                db.prepare("UPDATE memories SET content_blob = content WHERE content_blob = ''").run();
              }
              if (hasCol("state") && hasCol("semantic_state")) {
                db.prepare("UPDATE memories SET semantic_state = state WHERE semantic_state = 'Active' AND state != 'ACTIVE'").run();
              }
              if (hasCol("memory_type") && hasCol("kind")) {
                db.prepare("UPDATE memories SET kind = memory_type WHERE kind = 'TaskLog' AND memory_type != 'EPISODIC'").run();
              }
              if (hasCol("agent_type") && hasCol("source")) {
                db.prepare("UPDATE memories SET source = json_object('agentType', agent_type, 'taskId', id) WHERE source = '{}' AND agent_type IS NOT NULL").run();
              }
              if (this._observer) {
                this._observer.emit({
                  type: PipelineEventType.MemorySqlDegraded,
                  priority: PipelinePriority.NORMAL,
                  payload: { source: "MemoryPersistence", detail: "v4->v5 迁移完成" },
                  timestamp: Date.now(),
                });
              }
            } catch (migrateErr) {
              if (this._observer) {
                this._observer.emit({
                  type: PipelineEventType.MemorySqlDegraded,
                  priority: PipelinePriority.NORMAL,
                  payload: { source: "MemoryPersistence", detail: `v4->v5 迁移跳过: ${migrateErr instanceof Error ? migrateErr.message : String(migrateErr)}` },
                  timestamp: Date.now(),
                });
              }
            }
          }
          // 更新 schema_version
          db.prepare("INSERT OR REPLACE INTO __meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
        }
      } else {
        db.prepare("INSERT OR REPLACE INTO __meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
      }
    } catch (_e) {
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

    // ── Column-level migration：旧 DB 列兼容 ──
    const ensureColumn = (table: string, col: string, colDef: string) => {
      try {
        const exists = db.prepare(
          `SELECT COUNT(*) as cnt FROM pragma_table_info('${table}') WHERE name = '${col}'`
        ).get() as { cnt: number } | undefined;
        if (!exists || exists.cnt === 0) {
          db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${colDef}`).run();
          if (this._observer) {
            this._observer.emit({
              type: PipelineEventType.MemorySqlDegraded,
              priority: PipelinePriority.NORMAL,
              payload: { source: "MemoryPersistence", detail: `${table} 表已迁移：添加 ${col} 列` },
              timestamp: Date.now(),
            });
          }
        }
      } catch (_alterErr) {
        // 列可能已存在，安全忽略
      }
    };
    // v3 新增列（旧 CREATE TABLE 可能缺这些）
    ensureColumn("memories", "semantic_state", "TEXT NOT NULL DEFAULT 'Active'");
    ensureColumn("memories", "kind", "TEXT NOT NULL DEFAULT 'TaskLog'");
    ensureColumn("memories", "source", "TEXT NOT NULL DEFAULT '{}'");
    ensureColumn("memories", "semantic_gist", "TEXT NOT NULL DEFAULT ''");
    ensureColumn("memories", "content_blob", "TEXT NOT NULL DEFAULT ''");
    ensureColumn("memories", "content_hash", "TEXT NOT NULL DEFAULT ''");
    ensureColumn("memories", "expires_at", "INTEGER");
    ensureColumn("memories", "access_count", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn("memories", "session_id", "TEXT");
    ensureColumn("memories", "updated_at", "INTEGER");

    // 从 SQLite 加载存量数据到 MemoryStorage
    const memRows = db.prepare("SELECT * FROM memories").all() as Record<string, unknown>[];
    for (const raw of memRows) {
      const entry = storage.deserializeRow(raw);
      if (!entry) continue;
      storage.memories.set(entry.id, entry);
    }

    // 输出反序列化失败汇总 + 清理 SQLite 中损坏的行
    const corruptedIds = storage.flushDeserializeErrors();
    if (corruptedIds.length > 0) {
      // 分片 DELETE（SQLITE_MAX_VARIABLE_NUMBER 默认 999）
      // 包裹 try/catch：DB 本身可能已损坏（disk image malformed），清理失败不应让管道崩溃
      try {
        const CHUNK = 200;
        for (let i = 0; i < corruptedIds.length; i += CHUNK) {
          const chunk = corruptedIds.slice(i, i + CHUNK);
          const placeholders = chunk.map(() => "?").join(",");
          db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...chunk);
        }
        if (this._observer) {
          this._observer.emit({
            type: PipelineEventType.MemorySqlDegraded,
            priority: PipelinePriority.NORMAL,
            payload: { source: "MemoryPersistence", detail: `已清理 ${corruptedIds.length} 条损坏记忆` },
            timestamp: Date.now(),
          });
        }
      } catch (cleanupErr) {
        console.warn(
          `[MemoryPersistence] 清理损坏记忆失败（DB 可能已损坏）: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`
        );
      }
    }

    const linkRows = db.prepare("SELECT * FROM links").all() as Record<string, unknown>[];
    for (const raw of linkRows) {
      const link: MemoryLink = {
        id: String(raw.id),
        sourceId: String(raw.source_id),
        targetId: String(raw.target_id),
        linkType: String(raw.link_type) as LinkType,
        weight: Number(raw.weight),
        targetState: String(raw.target_state) as SemanticState,
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

    // 语义态——默认只查 Active
    clauses.push("semantic_state = ?");
    params.push("Active");

    // 时效衰减：只返回 30 天内的记忆
    const cutoff = now - THIRTY_DAYS_MS;
    clauses.push("created_at > ?");
    params.push(cutoff);

    // 认知类别
    if (query.kind) {
      clauses.push("kind = ?");
      params.push(query.kind);
    }

    // Agent 类型——存储为 source JSON 内字段
    if (query.agentTypes && query.agentTypes.length > 0) {
      safeIn("json_extract(source, '$.agentType')", query.agentTypes);
    }

    // 时间范围
    if (query.timeRange) {
      clauses.push("created_at >= ? AND created_at <= ?");
      params.push(query.timeRange.start, query.timeRange.end);
    }

    // 关键词检索：优先 FTS5 全文索引（summary + semantic_gist），降级至 LIKE
    // 当 queryEmbedding 存在时跳过关键词过滤——向量排序精度更高
    if (!query.queryEmbedding && query.keywords && query.keywords.length > 0) {
      const ftsQuery = query.keywords.slice(0, 50).map((kw) => {
        return `"${kw.replace(/"/g, "")}"`;
      }).join(" OR ");
      clauses.push("rowid IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?)");
      params.push(ftsQuery);
    }

    // 向量召回模式下放宽候选集上限，让 vectorRecall 有足够素材做语义排序
    const vectorLimit = query.queryEmbedding ? 200 : 0;

    const sql = `SELECT * FROM memories WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC` +
      (vectorLimit > 0 ? ` LIMIT ${vectorLimit}` : "");

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
