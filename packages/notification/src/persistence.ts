// ============================================================
// @cortex/notification — 持久化层
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

import { NotificationChannel } from "./types.js";
import type { NotificationEvent } from "./types.js";

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
  private db: unknown = null;
  private available = false;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    // _init 异步执行——构造函数不阻塞，持久化可用性异步确定
    this._init().catch(() => {
      this.available = false;
    });
  }

  /** 持久化单条事件 */
  persist(event: NotificationEvent): void {
    if (!this.available) return;
    try {
      const stmt = (this.db as any).prepare(`
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
    if (!this.available) return [];
    try {
      const stmt = (this.db as any).prepare(`
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
    if (!this.available) return;
    try {
      const stmt = (this.db as any).prepare(`
        UPDATE notification_queue SET acked = 1, acked_at = ? WHERE request_id = ?
      `);
      stmt.run(Date.now(), requestId);
    } catch {
      // 静默降级
    }
  }

  /** 清理过期事件（TTL 过期） */
  cleanup(ttlMs: number): void {
    if (!this.available) return;
    try {
      const cutoff = Date.now() - ttlMs;
      const stmt = (this.db as any).prepare(`
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

  // ── 私有 ──────────────────────────────────────────

  private async _init(): Promise<void> {
    try {
      // 动态加载 better-sqlite3——避免 must-have 依赖
      // @ts-expect-error — better-sqlite3 是可选的运行时依赖，不在 package.json 中声明
      const BetterSqlite3 = await import("better-sqlite3");
      const Database = BetterSqlite3.default ?? BetterSqlite3;
      this.db = new (Database as any)(this.dbPath);
      (this.db as any).pragma("journal_mode = WAL");
      this._createTable();
      this.available = true;
    } catch {
      // better-sqlite3 不可用——降级为纯内存模式
      this.available = false;
    }
  }

  private _createTable(): void {
    (this.db as any).exec(`
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
