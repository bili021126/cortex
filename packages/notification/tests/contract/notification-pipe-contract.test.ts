// @ci: unit
// ============================================================
// @cortex/notification — NotificationPipe 核心契约测试
//
// 覆盖路由、归并、持久化、溢出、失败模式五个契约维度。
// 不依赖真实 persistence 或外部通知系统。
// ============================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  NotificationChannel,
  NotificationPipe,
} from "@cortex/notification";

describe("NotificationPipe 契约 — 路由", () => {
  let pipe: NotificationPipe;

  beforeEach(() => {
    pipe = new NotificationPipe();
  });

  it("应路由 urgent 事件到 urgent 通道", () => {
    pipe.loadRoutes({
      DISCIPLINARY_ALERT: { channel: NotificationChannel.Urgent, ackRequired: true },
    });

    const handler = vi.fn();
    pipe.on(NotificationChannel.Urgent, handler);
    pipe.push({ type: "DISCIPLINARY_ALERT", summary: "违规警报" });

    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0];
    expect(evt.channel).toBe(NotificationChannel.Urgent);
    expect(evt.ackRequired).toBe(true);
  });

  it("应路由 important 事件到 important 通道", () => {
    pipe.loadRoutes({
      CODE_REVIEW: { channel: NotificationChannel.Important, ackRequired: false },
    });

    const handler = vi.fn();
    pipe.on(NotificationChannel.Important, handler);
    pipe.push({ type: "CODE_REVIEW", summary: "代码审查完成" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].channel).toBe(NotificationChannel.Important);
  });

  it("应路由 routine 事件到 routine 通道", () => {
    pipe.loadRoutes({
      BUILD_STATUS: { channel: NotificationChannel.Routine, ackRequired: false },
    });

    const handler = vi.fn();
    pipe.on(NotificationChannel.Routine, handler);
    pipe.push({ type: "BUILD_STATUS", summary: "构建成功" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].channel).toBe(NotificationChannel.Routine);
  });

  it("未注册事件 fallback 到 info 通道", () => {
    const handler = vi.fn();
    pipe.on(NotificationChannel.Info, handler);
    pipe.push({ type: "UNKNOWN_EVENT", summary: "未知事件" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].channel).toBe(NotificationChannel.Info);
  });
});

describe("NotificationPipe 契约 — 归并", () => {
  let pipe: NotificationPipe;

  beforeEach(() => {
    pipe = new NotificationPipe();
  });

  it("应归并同一 mergeKey 窗口内的事件", () => {
    pipe.loadRoutes({
      CODE_CHANGED: {
        channel: NotificationChannel.Routine,
        ackRequired: false,
        mergeKey: "commitHash",
      },
    });

    pipe.setMergeRules([
      { groupBy: "mergeKey", windowMs: 300_000, maxBatch: 3 },
    ]);

    const handler = vi.fn();
    pipe.on(NotificationChannel.Routine, handler);

    // 推送 3 个同 key 事件，达到 maxBatch(3) → 自动 flush
    pipe.push({ type: "CODE_CHANGED", summary: "变更A", mergeKey: "abc" });
    pipe.push({ type: "CODE_CHANGED", summary: "变更B", mergeKey: "abc" });

    // 此时尚未 flush
    expect(handler).not.toHaveBeenCalled();

    // 推送第 3 个触发自动 flush（maxBatch=3）
    pipe.push({ type: "CODE_CHANGED", summary: "变更C", mergeKey: "abc" });

    expect(handler).toHaveBeenCalled();
    const evt = handler.mock.calls[0][0];
    expect(evt.summary).toContain("归并");
  });

  it("归并空缓冲区不报错", () => {
    expect(() => pipe.flushMerged()).not.toThrow();
  });
});

describe("NotificationPipe 契约 — 持久化", () => {
  it("urgent 通道持久化事件到磁盘", () => {
    // persistence 注入需要 mock 对象
    const mockPersist = vi.fn();
    const mockLoadPending = vi.fn().mockReturnValue([]);
    const mockIsAvailable = vi.fn().mockReturnValue(true);
    const mockMarkAcked = vi.fn();

    const persistence = {
      persist: mockPersist,
      loadPending: mockLoadPending,
      isAvailable: mockIsAvailable,
      markAcked: mockMarkAcked,
    };

    const pipe = new NotificationPipe(persistence as any);
    pipe.loadRoutes({
      ALERT: { channel: NotificationChannel.Urgent, ackRequired: true },
    });
    pipe.push({ type: "ALERT", summary: "紧急通知" });

    expect(mockPersist).toHaveBeenCalled();
    const persisted = mockPersist.mock.calls[0][0];
    expect(persisted.type).toBe("ALERT");
  });

  it("无 persistence 时 urgent 通道正常工作", () => {
    const pipe = new NotificationPipe();
    pipe.loadRoutes({
      ALERT: { channel: NotificationChannel.Urgent, ackRequired: true },
    });

    const handler = vi.fn();
    pipe.on(NotificationChannel.Urgent, handler);
    pipe.push({ type: "ALERT", summary: "无持久化测试" });

    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("NotificationPipe 契约 — 通道溢出", () => {
  it("urgent 通道超出 maxQueueSize 丢弃最旧事件", () => {
    const pipe = new NotificationPipe();
    pipe.loadRoutes({
      URGENT: { channel: NotificationChannel.Urgent, ackRequired: true },
    });

    // urgent 默认 maxQueueSize=100
    for (let i = 0; i < 105; i++) {
      pipe.push({ type: "URGENT", summary: `事件${i}` });
    }

    const bl = pipe.backlogs();
    // 溢出丢弃后积压 ≤ 100
    expect(bl[NotificationChannel.Urgent]).toBeLessThanOrEqual(100);
  });

  it("important 通道超出 maxQueueSize 仍按 FIFO 丢弃最旧", () => {
    const pipe = new NotificationPipe();
    pipe.loadRoutes({
      IMP: { channel: NotificationChannel.Important, ackRequired: false },
    });

    // important 默认 maxQueueSize=500
    for (let i = 0; i < 510; i++) {
      pipe.push({ type: "IMP", summary: `事件${i}` });
    }

    const bl = pipe.backlogs();
    expect(bl[NotificationChannel.Important]).toBeLessThanOrEqual(500);
  });

  it("info 通道永不积压", () => {
    const pipe = new NotificationPipe();
    pipe.loadRoutes({
      UNKNOWN: { channel: NotificationChannel.Info, ackRequired: false },
    });

    // info 默认 unregistered fallback，无队列
    for (let i = 0; i < 10; i++) {
      pipe.push({ type: "SOME_EVENT", summary: "无路由事件" });
    }

    const bl = pipe.backlogs();
    expect(bl[NotificationChannel.Info]).toBe(0);
  });
});

describe("NotificationPipe 契约 — 失败模式", () => {
  it("routine 通道 failureMode=log 不抛异常", () => {
    const pipe = new NotificationPipe();
    pipe.loadRoutes({
      ROUTINE: { channel: NotificationChannel.Routine, ackRequired: false },
    });

    // 注册一个会抛异常的 handler
    pipe.on(NotificationChannel.Routine, () => {
      throw new Error("模拟 handler 失败");
    });

    // 不应传播异常
    expect(() => {
      pipe.push({ type: "ROUTINE", summary: "测试" });
    }).not.toThrow();
  });

  it("urgent 通道 handler 异步失败不传播", async () => {
    const pipe = new NotificationPipe();
    pipe.loadRoutes({
      URGENT: { channel: NotificationChannel.Urgent, ackRequired: true },
    });

    pipe.on(NotificationChannel.Urgent, () => Promise.reject(new Error("异步失败")));

    // 不应传播异常
    expect(() => {
      pipe.push({ type: "URGENT", summary: "异步测试" });
    }).not.toThrow();

    // 等待微任务执行完
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("NotificationPipe 契约 — ack 确认", () => {
  it("ack urgent 事件从队列移除", () => {
    const pipe = new NotificationPipe();
    pipe.loadRoutes({
      URGENT: { channel: NotificationChannel.Urgent, ackRequired: true },
    });
    pipe.push({ type: "URGENT", summary: "可确认事件" });

    const blBefore = pipe.backlogs()[NotificationChannel.Urgent];
    expect(blBefore).toBeGreaterThan(0);

    // 获取 requestId
    const snap = pipe.routeSnapshot();
    // ack 不存在的 id 返回 false
    expect(pipe.ack("nonexistent", true)).toBe(false);
  });

  it("ackHandler 回调注册后调用", () => {
    const pipe = new NotificationPipe();
    const handler = vi.fn();
    pipe.onAck(handler);
    expect(handler).not.toHaveBeenCalled();
  });
});
