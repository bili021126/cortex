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
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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
  close(): void;
}

/** better-sqlite3 预处理语句的最小接口 */
interface SqliteStatement {
  run(...params: unknown[]): void;
  all(...params: unknown[]): unknown[];
  /** 单行查询——行数统计使用（R13-D1） */
  get(...params: unknown[]): unknown;
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
  /** 上次清理时间——读路径自清理节流（R13-D1） */
  private _lastCleanupAt = 0;
  /** 自上次清理以来写入的行数——写入路径自清理阈值触发（R13-D1） */
  private _persistSinceCleanup = 0;

  // ── 保留策略常量（R13-D1）─────────────────────────
  //
  // 背景：此前 cleanup 仅删 `acked = 1` 的行，而 Important 通道 push() 恒写 acked=0
  // 且该通道没有任何 ack 路径（markAcked 只从 UrgentChannel.ack() 调用）——
  // 其行永远进不了清理条件，notification_queue 无界增长
  // （实测 2026-08-03/04 一次事件风暴留下 9,693,221 行 / 1.97 GB，全部 acked=0）。
  //
  // 三段式保留：已确认行按 TTL、未确认行按硬上限、总量按行数兜底。

  /**
   * 内部自清理默认保留期。
   * 与重构前 loadPending 内硬编码的 7 天一致，保持已确认行的保留行为不变。
   * 注意：ChannelConfig.persistTtlMs 尚未接入此处（该字段目前全仓库零消费）。
   */
  private static readonly DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * 未确认行的保留硬上限——未确认不等于永久有效。
   * 未确认超过此期限的事件已失去「重启恢复」的意义，保留只会撑大磁盘。
   */
  private static readonly UNACKED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * 表行数硬上限——兜底防线，防止事件风暴（如单日 700 万条 error.reported）
   * 在两次清理之间把库撑爆。超出部分按 timestamp 从旧到新裁掉。
   */
  private static readonly MAX_ROWS = 50_000;

  /** 读路径自清理最小间隔——避免每次 loadPending 都在大表上做统计与删除 */
  private static readonly CLEANUP_THROTTLE_MS = 5 * 60 * 1000;

  /** 写入路径自清理阈值——风暴期间不必等节流窗口到期 */
  private static readonly PERSIST_CLEANUP_THRESHOLD = 10_000;

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
    } catch (err) {
      // R11-05：不再空吞——上报 stderr（可观测）——持久化失败不阻塞通知管线
      process.stderr.write(`[NotificationPersistence] persist 失败: ${String(err).slice(0, 200)}\n`);
      return;
    }
    // R13-D1：写入路径自清理——风暴期间不必等节流窗口到期才回收
    if (++this._persistSinceCleanup >= NotificationPersistence.PERSIST_CLEANUP_THRESHOLD) {
      this._persistSinceCleanup = 0;
      this.cleanup(NotificationPersistence.DEFAULT_RETENTION_MS);
    }
  }

  /** 从磁盘加载指定通道的未确认事件 */
  loadPending(channel: NotificationChannel): NotificationEvent[] {
    if (!this.available || !this.db) return [];
    // R12-D4：读取前清理过期行。
    // R13-D1：改为节流调用——此前每次 loadPending 都无条件清理，
    //   在大表上跑统计与删除会拖慢读取；cleanup() 自身记录清理时刻。
    if (Date.now() - this._lastCleanupAt >= NotificationPersistence.CLEANUP_THROTTLE_MS) {
      try { this.cleanup(NotificationPersistence.DEFAULT_RETENTION_MS); } catch { /* 清理失败不阻断读取 */ }
    }
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

  /**
   * 清理过期事件。
   *
   * R13-D1：从「仅删已确认行」扩展为三段式保留——
   *   1. 已确认行：按调用方传入的 TTL 清理。
   *   2. 未确认行：按 `UNACKED_RETENTION_MS` 硬上限清理。
   *      此前只删 `acked = 1`，而 Important 通道无 ack 路径（push 恒写 acked=0），
   *      其行永远进不了清理条件 → 无界增长。
   *   3. 行数硬上限：超出 `MAX_ROWS` 的部分按 timestamp 从旧到新裁掉（风暴兜底）。
   *
   * @param ttlMs 已确认行的保留期（ms）
   */
  cleanup(ttlMs: number): void {
    if (!this.available || !this.db) return;
    this._lastCleanupAt = Date.now();
    this._persistSinceCleanup = 0;
    const now = this._lastCleanupAt;
    try {
      // 1) 已确认行：按 TTL 清理
      this.db
        .prepare(`DELETE FROM notification_queue WHERE acked = 1 AND timestamp < ?`)
        .run(now - ttlMs);
      // 2) 未确认行：按保留硬上限清理（不小于已确认行的 TTL）
      const unackedTtl = Math.max(ttlMs, NotificationPersistence.UNACKED_RETENTION_MS);
      this.db
        .prepare(`DELETE FROM notification_queue WHERE acked = 0 AND timestamp < ?`)
        .run(now - unackedTtl);
      // 3) 行数硬上限兜底
      const countRow = this.db
        .prepare(`SELECT count(*) AS n FROM notification_queue`)
        .get() as { n: number } | undefined;
      const total = countRow?.n ?? 0;
      if (total > NotificationPersistence.MAX_ROWS) {
        this.db
          .prepare(
            `DELETE FROM notification_queue WHERE rowid IN (
               SELECT rowid FROM notification_queue ORDER BY timestamp ASC LIMIT ?
             )`,
          )
          .run(total - NotificationPersistence.MAX_ROWS);
      }
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

  /** 关闭数据库连接——释放文件句柄（Windows 下删除目录依赖句柄释放） */
  close(): void {
    if (!this.db) return;
    try {
      this.db.close();
    } catch {
      // 关闭失败不抛——幂等降级
    }
    this.db = null;
    this.available = false;
  }

  // ── 私有 ──────────────────────────────────────────

  private async _init(): Promise<void> {
    try {
      // 动态加载 better-sqlite3——避免 must-have 依赖
      //（@types/better-sqlite3 为 devDependency，类型仅测试期可见）
      const BetterSqlite3 = await import("better-sqlite3");
      const Database = BetterSqlite3.default ?? BetterSqlite3;
      // 确保父目录存在（与 FileCollector 一致——dbPath 目录可能尚未创建）
      mkdirSync(dirname(this.dbPath), { recursive: true });
      this.db = new Database(this.dbPath) as unknown as SqliteDb;
      this.db.pragma("journal_mode = WAL");
      // R12-A1：_createTable 返回可用性——降级守卫置 false 后不被无条件覆盖（R11-05 回归修复）
      this.available = this._createTable();
      // R13-D1：启动即做一次保留清理——把上次运行遗留的过期行（含未确认积压）收回，
      // 且让迁移新建的索引立刻在一张已收敛的表上生效。
      if (this.available) {
        this.cleanup(NotificationPersistence.DEFAULT_RETENTION_MS);
      }
    } catch {
      // better-sqlite3 不可用——降级为纯内存模式
      this.available = false;
    }
  }

  /**
   * R11-05：数据库 schema 版本（PRAGMA user_version 门控——此前 CREATE IF NOT EXISTS 无迁移，schema 变更静默杀死持久化）。
   * R13-D1：1 → 2，新增 loadPending / cleanup 的复合索引。
   */
  private static readonly SCHEMA_VERSION = 2;

  private _createTable(): boolean {
    if (!this.db) return false;
    // 读 user_version（better-sqlite3 simple 模式返回 number）
    const row = (this.db.pragma as unknown as (sql: string, opts?: { simple: boolean }) => unknown)("user_version", { simple: true });
    const current = typeof row === "number" ? row : 0;
    // 降级守卫：拒绝操作比代码新的 schema（避免 INSERT 列不匹配每次 persist 抛错且被吞）
    if (current > NotificationPersistence.SCHEMA_VERSION) {
      process.stderr.write(`[NotificationPersistence] 数据库 schema 版本 ${current} 高于代码支持的 ${NotificationPersistence.SCHEMA_VERSION}——持久化禁用\n`);
      this.available = false;
      return false;
    }
    // 迁移链：每一步把 user_version 推进到该步版本，新增步骤追加在末尾。
    // v0 → v1：建表（保真记录 v1 当时实际创建的索引，含随后被 v2 取代的 idx_nq_channel）
    if (current < 1) {
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
      this.db.pragma(`user_version = 1`);
    }
    // v1 → v2：补复合索引。loadPending 的 `channel = ? AND acked = 0 ORDER BY timestamp`
    // 此前只能靠单列 idx_nq_channel 过滤后在内存排序；cleanup 的两个 DELETE
    // （acked = ? AND timestamp < ?）此前无可用索引。
    // idx_nq_channel 是 idx_nq_load 的最左前缀——任何能用它的查询都能用后者，故予删除以免白付写入代价。
    if (current < 2) {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_nq_load ON notification_queue(channel, acked, timestamp);
        CREATE INDEX IF NOT EXISTS idx_nq_cleanup ON notification_queue(acked, timestamp);
        DROP INDEX IF EXISTS idx_nq_channel;
      `);
      this.db.pragma(`user_version = 2`);
    }
    return true;
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
