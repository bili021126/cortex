// @ci: unit
// ============================================================
// @cortex/notification —— NotificationPersistence 磁盘持久化守护测试
//
// 守护（spec S2-10/S2-11）：Urgent/Important 通知必须落盘可查——
// persist → loadPending 读回 → markAcked → 重启后未确认通知仍可恢复。
// 使用真实 better-sqlite3（与生产一致），临时目录隔离。
// ============================================================

import { describe, it, expect } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { rm } from "fs/promises";

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
