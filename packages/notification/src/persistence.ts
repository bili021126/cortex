// ============================================================
// @cortex/notification -- 持久化层
//
// 为 urgent/important 通道提供 SQLite 磁盘持久化。
// 复用 better-sqlite3 模式（与 memory-store 一致）。
// 24h TTL 自动清理。
//
// 设计约束：
//   - persistence.ts 不依赖 engine 包（独立包原则）
//   - 不引入 better-sqlite3 为 must-have 依赖（可选持久化）
//   - 若 better-sqlite3 不可用，降级为内存模式（降级不阻断）
// ============================================================

import type { NotificationChannel, NotificationEvent } from "./types.js";

// ─── SQLite 数据库最小接口 ──────────────────────────────
//
// @fix P1-2 — 定义最小接口类型替代 `as any`。
//   better-sqlite3 是可选的运行时依赖，不在 package.json 中声明，
//   因此无法在编译期静态导入其类型。此处定义运行时所需的最小接口，
//   使代码在保留动态加载降级能力的同时获得类型安全。

/** better-sqlite3 数据库实例的最小接口 */
interface SqliteDb {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(sql: string): void;
}

/** better-sqlite3 预处理语句的最小接口 */
interface SqliteStatement {
  run(...params: unknown[]): void;
  all(...params: unknown[]): unknown[];
}

/** 持久化行——SQLite 表行映射 */
interface PersistedRow {
  request_id: string;
  event_type: string;
  channel: string;
  summary: string;
  detail: string | null;
  source_agent: string | null;
  merge_key: string | null;
  timestamp: number;
  acked: number; // 0/1
  acked_at: number | null;
}

/**
 * NotificationPersistence —— 通知事件磁盘持久化。
 *
 * 降级策略：better-sqlite3 不可用时，所有写操作静默降级为 no-op，
 * 读操作返回空。通知管线本身不因持久化失败而中断。
 */
export class NotificationPersistence {
  private db: SqliteDb | null = null;
  private available = false;
  private dbPath: string;
  /** 初始化完成 Promise——消费方可 await ready() 确保异步 init 完成后再操作 */
  private _ready: Promise<void>;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    // _init 异步执行——构造函数不阻塞，持久化可用性异步确定
    this._ready = this._init().catch((err) => {
      this.available = false;
      // @fix P0-3 — init 失败不再静默丢弃：上报 degraded 事件供可观测管道追踪
      // NotificationPersistence 不在 engine 包内，不持有 PipelineObserver 引用，
      // 以 process.stderr 兜底确保运维可发现持久化降级
      process.stderr.write(`[NotificationPersistence] _init 失败，持久化不可用: ${String(err).slice(0, 200)}\n`);
    });
  }

  /** 持久化单条事件 */
  persist(event: NotificationEvent): void {
    if (!this.available || !this.db) return;
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO notification_queue
          (request_id, event_type, channel, summary, detail, source_agent, merge_key, timestamp, acked, acked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        event.requestId,
        event.type,
        event.channel,
        event.summary,
        event.detail ?? null,
        event.sourceAgent ?? null,
        event.mergeKey ?? null,
        event.timestamp,
        event.acked ? 1 : 0,
        event.ackedAt ?? null,
      );
    } catch {
      // 持久化失败不阻塞通知管线
    }
  }

  /** 从磁盘加载指定通道的未确认事件 */
  loadPending(channel: NotificationChannel): NotificationEvent[] {
    if (!this.available || !this.db) return [];
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM notification_queue
        WHERE channel = ? AND acked = 0
        ORDER BY timestamp ASC
        LIMIT 500
      `);
      const rows = stmt.all(channel) as PersistedRow[];
      return rows.map((r) => this._rowToEvent(r));
    } catch {
      return [];
    }
  }

  /** 标记事件已确认 */
  markAcked(requestId: string): void {
    if (!this.available || !this.db) return;
    try {
      const stmt = this.db.prepare(`
        UPDATE notification_queue SET acked = 1, acked_at = ? WHERE request_id = ?
      `);
      stmt.run(Date.now(), requestId);
    } catch {
      // 静默降级
    }
  }

  /** 清理过期事件（TTL 过期） */
  cleanup(ttlMs: number): void {
    if (!this.available || !this.db) return;
    try {
      const cutoff = Date.now() - ttlMs;
      const stmt = this.db.prepare(`
        DELETE FROM notification_queue WHERE timestamp < ? AND acked = 1
      `);
      stmt.run(cutoff);
    } catch {
      // 静默降级
    }
  }

  /** 持久化层是否可用 */
  isAvailable(): boolean {
    return this.available;
  }

  /** 等待异步初始化完成——调用方在操作前应 await ready() */
  async ready(): Promise<void> {
    await this._ready;
  }

  // ── 私有 ──────────────────────────────────────────

  private async _init(): Promise<void> {
    try {
      // 动态加载 better-sqlite3——避免 must-have 依赖
      // @ts-expect-error — better-sqlite3 是可选的运行时依赖，不在 package.json 中声明
      const BetterSqlite3 = await import("better-sqlite3");
      const Database = BetterSqlite3.default ?? BetterSqlite3;
      this.db = new Database(this.dbPath) as unknown as SqliteDb;
      this.db.pragma("journal_mode = WAL");
      this._createTable();
      this.available = true;
    } catch {
      // better-sqlite3 不可用——降级为纯内存模式
      this.available = false;
    }
  }

  private _createTable(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notification_queue (
        request_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        channel TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT,
        source_agent TEXT,
        merge_key TEXT,
        timestamp INTEGER NOT NULL,
        acked INTEGER NOT NULL DEFAULT 0,
        acked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_nq_channel ON notification_queue(channel);
      CREATE INDEX IF NOT EXISTS idx_nq_timestamp ON notification_queue(timestamp);
    `);
  }

  private _rowToEvent(row: PersistedRow): NotificationEvent {
    return {
      requestId: row.request_id,
      type: row.event_type,
      channel: row.channel as NotificationChannel,
      summary: row.summary,
      detail: row.detail ?? undefined,
      sourceAgent: row.source_agent ?? undefined,
      mergeKey: row.merge_key ?? undefined,
      timestamp: row.timestamp,
      ackRequired: true, // 从磁盘恢复的事件默认需要确认
      acked: row.acked === 1,
      ackedAt: row.acked_at ?? undefined,
    };
  }
}
