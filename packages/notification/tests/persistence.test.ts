// @ci: unit
// ============================================================
// @cortex/notification —— NotificationPersistence 磁盘持久化守护测试
//
// 守护（spec S2-10/S2-11）：Urgent/Important 通知必须落盘可查——
// persist → loadPending 读回 → markAcked → 重启后未确认通知仍可恢复。
// 使用真实 better-sqlite3（与生产一致），临时目录隔离。
// ============================================================

import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { rm } from "fs/promises";
import Database from "better-sqlite3";

import { NotificationPersistence, NotificationChannel, type NotificationEvent } from "../src/index.js";

function makeDbPath(): string {
  return join(tmpdir(), "cortex-notif-persist-test", randomUUID(), "notifications.db");
}

function makeEvent(overrides?: Partial<NotificationEvent>): NotificationEvent {
  return {
    requestId: overrides?.requestId ?? `notif-${randomUUID()}`,
    type: overrides?.type ?? "SchedulerLoopCrashed",
    channel: overrides?.channel ?? NotificationChannel.Urgent,
    ackRequired: overrides?.ackRequired ?? true,
    summary: overrides?.summary ?? "调度器循环崩溃",
    detail: overrides?.detail ?? "detail",
    sourceAgent: overrides?.sourceAgent ?? "cyrene",
    timestamp: overrides?.timestamp ?? Date.now(),
  };
}

describe("NotificationPersistence（spec S2-10 落盘可查）", () => {
  it("persist 后 loadPending 可读回（Urgent 通道）", async () => {
    const dbPath = makeDbPath();
    const p = new NotificationPersistence(dbPath);
    await p.ready();
    expect(p.isAvailable()).toBe(true);

    const event = makeEvent();
    p.persist(event);

    const pending = p.loadPending(NotificationChannel.Urgent);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      requestId: event.requestId,
      type: event.type,
      channel: NotificationChannel.Urgent,
      summary: event.summary,
      detail: event.detail,
      sourceAgent: event.sourceAgent,
    });
    expect(pending[0]?.acked).toBe(false);
  });

  it("markAcked 后不再出现在 pending（ack 回路落盘）", async () => {
    const dbPath = makeDbPath();
    const p = new NotificationPersistence(dbPath);
    await p.ready();

    const event = makeEvent();
    p.persist(event);
    expect(p.loadPending(NotificationChannel.Urgent)).toHaveLength(1);

    p.markAcked(event.requestId);
    expect(p.loadPending(NotificationChannel.Urgent)).toHaveLength(0);
  });

  it("重启后未确认通知可恢复（同一 db 文件新实例读回）", async () => {
    const dbPath = makeDbPath();

    // 第一轮：写入 2 条，确认 1 条
    const p1 = new NotificationPersistence(dbPath);
    await p1.ready();
    const acked = makeEvent({ requestId: "keep-acked" });
    const unacked = makeEvent({ requestId: "keep-unacked" });
    p1.persist(acked);
    p1.persist(unacked);
    p1.markAcked(acked.requestId);

    // 第二轮：模拟重启——新实例打开同一文件
    const p2 = new NotificationPersistence(dbPath);
    await p2.ready();

    const pending = p2.loadPending(NotificationChannel.Urgent);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.requestId).toBe("keep-unacked");
    expect(pending[0]?.acked).toBe(false);
  });

  it("Important 通道独立持久化（FIFO 通道同样落盘）", async () => {
    const dbPath = makeDbPath();
    const p = new NotificationPersistence(dbPath);
    await p.ready();

    const event = makeEvent({
      channel: NotificationChannel.Important,
      type: "MemoryPersistFailed",
      ackRequired: false,
    });
    p.persist(event);

    const pending = p.loadPending(NotificationChannel.Important);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.type).toBe("MemoryPersistFailed");
    // 不串通道
    expect(p.loadPending(NotificationChannel.Urgent)).toHaveLength(0);
  });

  it("cleanup 仅清除已 ack 的过期条目（TTL 语义）", async () => {
    const dbPath = makeDbPath();
    const p = new NotificationPersistence(dbPath);
    await p.ready();

    const oldAcked = makeEvent({ requestId: "old-acked", timestamp: Date.now() - 24 * 3600 * 1000 - 1000 });
    const oldUnacked = makeEvent({ requestId: "old-unacked", timestamp: Date.now() - 24 * 3600 * 1000 - 1000 });
    const freshAcked = makeEvent({ requestId: "fresh-acked", timestamp: Date.now() });
    p.persist(oldAcked);
    p.persist(oldUnacked);
    p.persist(freshAcked);
    p.markAcked(oldAcked.requestId);
    p.markAcked(freshAcked.requestId);

    p.cleanup(24 * 3600 * 1000);

    // 过期且已 ack → 清除；过期未 ack → 保留（仍需人工确认）；
    // 已 ack 的条目（无论新旧）不再出现在 pending（loadPending 仅未确认）
    expect(p.loadPending(NotificationChannel.Urgent).map((e) => e.requestId)).toEqual([
      "old-unacked",
    ]);
  });

  it("未知 requestId 的 markAcked 不抛错（幂等）", async () => {
    const dbPath = makeDbPath();
    const p = new NotificationPersistence(dbPath);
    await p.ready();

    expect(() => p.markAcked("no-such-request")).not.toThrow();
    await rm(join(dbPath, ".."), { recursive: true, force: true }).catch(() => {});
  });
});

// ══════════════════════════════════════════════════════════
// R13-D1 —— notification_queue 无界增长修复的回归守护
//
// 实测缺陷：Important 通道 push() 恒写 acked=0，且该通道没有任何 ack 路径
// （markAcked 只从 UrgentChannel.ack() 调用）→ 其行永远进不了旧 cleanup 的
// `WHERE acked = 1` 条件。2026-08-03/04 一次事件风暴留下 9,693,221 行
// （全部 acked=0）/ 1.97 GB，永不回收。
// ══════════════════════════════════════════════════════════

/** v1 时期的建表语句——用于预置历史库，验证迁移链 */
const V1_SCHEMA = `
  CREATE TABLE notification_queue (
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
  CREATE INDEX idx_nq_channel ON notification_queue(channel);
  CREATE INDEX idx_nq_timestamp ON notification_queue(timestamp);
  PRAGMA user_version = 1;
`;

/** 用原始连接读取行数——绕过被测类，作为独立证据 */
function rawRowCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT count(*) AS n FROM notification_queue").get() as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

function rawIndexNames(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map(
      (r) => r.name,
    );
  } finally {
    db.close();
  }
}

describe("NotificationPersistence —— 保留策略（R13-D1）", () => {
  it("未确认行超过保留硬上限后被清理（本次缺陷的直接回归）", async () => {
    const dbPath = makeDbPath();
    const p = new NotificationPersistence(dbPath);
    await p.ready();

    // Important 通道：ackRequired=false，落盘后永远 acked=0
    const stale = makeEvent({
      requestId: "imp-stale",
      channel: NotificationChannel.Important,
      ackRequired: false,
      timestamp: Date.now() - 8 * 24 * 3600 * 1000, // 超过 7 天未确认保留上限
    });
    const fresh = makeEvent({
      requestId: "imp-fresh",
      channel: NotificationChannel.Important,
      ackRequired: false,
      timestamp: Date.now(),
    });
    p.persist(stale);
    p.persist(fresh);
    expect(p.loadPending(NotificationChannel.Important)).toHaveLength(2);

    p.cleanup(24 * 3600 * 1000);

    // 修复前：两条都留在盘上（旧 cleanup 只删 acked = 1）
    expect(p.loadPending(NotificationChannel.Important).map((e) => e.requestId)).toEqual(["imp-fresh"]);
  });

  it("未过期的未确认行不被清理（保留期语义未被收窄）", async () => {
    const dbPath = makeDbPath();
    const p = new NotificationPersistence(dbPath);
    await p.ready();

    const withinWindow = makeEvent({
      requestId: "imp-2d",
      channel: NotificationChannel.Important,
      ackRequired: false,
      timestamp: Date.now() - 2 * 24 * 3600 * 1000, // 2 天 < 7 天硬上限
    });
    p.persist(withinWindow);
    p.cleanup(24 * 3600 * 1000);

    expect(p.loadPending(NotificationChannel.Important).map((e) => e.requestId)).toEqual(["imp-2d"]);
  });

  it("行数超过硬上限时按最旧优先裁剪（风暴兜底）", async () => {
    const dbPath = makeDbPath();
    mkdirSync(dirname(dbPath), { recursive: true });
    const raw = new Database(dbPath);
    raw.exec(V1_SCHEMA);
    // 预置 50,010 行未确认事件（逐条 persist 太慢，用一条递归 CTE 批量灌入）
    // 时间戳跨度约 13.9 小时——全部在保留期内，只有行数上限能裁掉它们
    const now = Date.now();
    raw.exec(`
      WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 50010)
      INSERT INTO notification_queue (request_id, event_type, channel, summary, timestamp, acked)
      SELECT 'bulk-' || i, 'error.reported', 'important', 'bulk', ${now} - (50010 - i) * 1000, 0 FROM seq;
    `);
    raw.close();

    const p = new NotificationPersistence(dbPath);
    await p.ready();
    expect(p.isAvailable()).toBe(true);

    expect(rawRowCount(dbPath)).toBe(50_000);
    // 裁掉的是最旧的 10 行
    const check = new Database(dbPath, { readonly: true });
    const oldest = check
      .prepare("SELECT request_id FROM notification_queue ORDER BY timestamp ASC LIMIT 1")
      .get() as { request_id: string };
    check.close();
    expect(oldest.request_id).toBe("bulk-11");
  }, 30_000);

  it("写入路径自清理：连续写入触发保留清理，风暴不在两次读之间累积", async () => {
    const dbPath = makeDbPath();
    const p = new NotificationPersistence(dbPath);
    await p.ready();

    const staleTs = Date.now() - 8 * 24 * 3600 * 1000;
    for (let i = 0; i < 10_001; i++) {
      p.persist(
        makeEvent({
          requestId: `storm-${i}`,
          channel: NotificationChannel.Important,
          ackRequired: false,
          timestamp: staleTs,
        }),
      );
    }

    // 第 10,000 次 persist 触发清理并删除全部过期行——表不随写入量线性增长
    expect(rawRowCount(dbPath)).toBeLessThan(100);
  }, 60_000);

  it("schema 迁移 v1 → v2：补复合索引并删除被取代的单列索引", async () => {
    const dbPath = makeDbPath();
    mkdirSync(dirname(dbPath), { recursive: true });
    const raw = new Database(dbPath);
    raw.exec(V1_SCHEMA);
    expect(raw.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    raw.close();

    const p = new NotificationPersistence(dbPath);
    await p.ready();
    expect(p.isAvailable()).toBe(true);

    const names = rawIndexNames(dbPath);
    expect(names).toContain("idx_nq_load"); // loadPending: (channel, acked, timestamp)
    expect(names).toContain("idx_nq_cleanup"); // cleanup: (acked, timestamp)
    expect(names).not.toContain("idx_nq_channel"); // 已被 idx_nq_load 最左前缀取代

    const check = new Database(dbPath, { readonly: true });
    expect(check.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    check.close();
  });
});
