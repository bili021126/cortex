// @ci: unit
/**
 * @cortex/server — 通知消费端接线守护测试（spec S2-11/S2-12）
 *
 * 守护：
 *   1. Urgent/Important 通知经桥接推送 WS notification.pushed（落地可查）
 *   2. Routine 通道不推送（桥接只订阅 Urgent/Important）
 *   3. notification.ack 回路：客户端应答 → 回执 + 持久化 markAcked
 */

import { describe, it, expect } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

import {
  NotificationPipe,
  NotificationPersistence,
  NotificationChannel,
  type NotificationEvent,
} from "@cortex/notification";
import {
  bridgeNotifications,
  handleNotificationAck,
  toNotificationPushedData,
} from "../src/notification-bridge.js";

function makeEvent(overrides?: Partial<NotificationEvent>): NotificationEvent {
  return {
    requestId: overrides?.requestId ?? `notif-${randomUUID()}`,
    type: overrides?.type ?? "SchedulerLoopCrashed",
    channel: overrides?.channel ?? NotificationChannel.Urgent,
    ackRequired: overrides?.ackRequired ?? true,
    summary: overrides?.summary ?? "调度器循环崩溃",
    detail: overrides?.detail,
    sourceAgent: overrides?.sourceAgent,
    timestamp: overrides?.timestamp ?? Date.now(),
  };
}

describe("bridgeNotifications（S2-11 消费端接线）", () => {
  it("Urgent 通知 → 广播 notification.pushed（字段完整）", () => {
    const pipe = new NotificationPipe();
    const broadcasts: Array<{ channel: string; data: unknown }> = [];
    const unbind = bridgeNotifications(pipe, (channel, data) => broadcasts.push({ channel, data }));

    const event = makeEvent({ requestId: "req-u1", summary: "紧急：调度循环崩溃" });
    pipe.push(event);

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.channel).toBe("notification");
    expect(broadcasts[0]?.data).toEqual({
      type: "notification.pushed",
      requestId: "req-u1",
      eventType: "SchedulerLoopCrashed",
      channel: "urgent",
      summary: "紧急：调度循环崩溃",
      detail: undefined,
      sourceAgent: undefined,
      ackRequired: true,
      timestamp: event.timestamp,
    });

    unbind();
  });

  it("Important 通知 → 同样推送（WARNING 语义落地可查）", () => {
    const pipe = new NotificationPipe();
    const broadcasts: Array<{ channel: string; data: unknown }> = [];
    const unbind = bridgeNotifications(pipe, (channel, data) => broadcasts.push({ channel, data }));

    pipe.push(makeEvent({ requestId: "req-i1", channel: NotificationChannel.Important, type: "MemoryPersistFailed" }));

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.data).toMatchObject({
      type: "notification.pushed",
      requestId: "req-i1",
      eventType: "MemoryPersistFailed",
      channel: "important",
    });

    unbind();
  });

  it("Routine 通知不推送（桥接仅订阅 Urgent/Important）", () => {
    const pipe = new NotificationPipe();
    const broadcasts: unknown[] = [];
    const unbind = bridgeNotifications(pipe, (channel, data) => broadcasts.push({ channel, data }));

    pipe.push(makeEvent({ requestId: "req-r1", channel: NotificationChannel.Routine, type: "NodeComplete" }));

    expect(broadcasts).toHaveLength(0);
    unbind();
  });

  it("解除订阅后不再广播（防 handler 累积泄漏）", () => {
    const pipe = new NotificationPipe();
    const broadcasts: unknown[] = [];
    const unbind = bridgeNotifications(pipe, (channel, data) => broadcasts.push({ channel, data }));

    unbind();
    pipe.push(makeEvent({ requestId: "req-u2" }));

    expect(broadcasts).toHaveLength(0);
  });

  it("toNotificationPushedData 与 WSNotificationEvent 协议形状一致", () => {
    const event = makeEvent({ requestId: "req-u3", detail: "细节", sourceAgent: "ganyu" });
    const data = toNotificationPushedData(event);
    expect(data.type).toBe("notification.pushed");
    expect(data.detail).toBe("细节");
    expect(data.sourceAgent).toBe("ganyu");
  });
});

describe("notification.ack 回路（S2-12）", () => {
  it("ack 生效：回执 acked=true + 积压清空", () => {
    const pipe = new NotificationPipe();
    pipe.push(makeEvent({ requestId: "req-ack-1" }));

    expect(pipe.backlogs()[NotificationChannel.Urgent]).toBe(1);

    const receipt = handleNotificationAck(pipe, "req-ack-1", true);

    expect(receipt).toEqual({ type: "notification.acked", requestId: "req-ack-1", acked: true });
    expect(pipe.backlogs()[NotificationChannel.Urgent]).toBe(0);
  });

  it("未知 requestId → acked=false（回执如实报告）", () => {
    const pipe = new NotificationPipe();
    const receipt = handleNotificationAck(pipe, "no-such-request", true);
    expect(receipt.acked).toBe(false);
  });

  it("pipe 缺失（engine 未就绪）→ acked=false 不抛错", () => {
    const receipt = handleNotificationAck(undefined, "req-x", true);
    expect(receipt).toEqual({ type: "notification.acked", requestId: "req-x", acked: false });
  });

  it("端到端：推送 → 订阅 → ack → 持久化 markAcked（真实 SQLite）", async () => {
    const dbPath = join(tmpdir(), "cortex-notif-bridge-test", randomUUID(), "notifications.db");
    const persistence = new NotificationPersistence(dbPath);
    const pipe = new NotificationPipe(persistence);
    await persistence.ready();

    const received: NotificationEvent[] = [];
    pipe.on(NotificationChannel.Urgent, (e) => received.push(e));

    const event = makeEvent({ requestId: "req-e2e" });
    pipe.push(event);

    // 订阅者收到 + 磁盘可见
    expect(received.map((e) => e.requestId)).toEqual(["req-e2e"]);
    expect(persistence.loadPending(NotificationChannel.Urgent).map((e) => e.requestId)).toEqual(["req-e2e"]);

    // ack → 磁盘 markAcked
    handleNotificationAck(pipe, "req-e2e", true);
    expect(persistence.loadPending(NotificationChannel.Urgent)).toHaveLength(0);
  });
});
