// @ci: unit
// ============================================================
// @cortex/notification — 通知管线功能测试
//
// 覆盖三块核心组件：
//   1. RouteTable —— 显式路由表 O(1) 查表 + fallback
//   2. 四物理通道 —— Urgent/Important/Routine/Info 各自策略
//   3. NotificationPipe —— 推送/路由/确认/归并/订阅
// ============================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  NotificationChannel,
  DEFAULT_CHANNEL_CONFIGS,
  RouteTable,
  UrgentChannel,
  ImportantChannel,
  RoutineChannel,
  InfoChannel,
  NotificationPipe,
} from "../src/index.js";
import type { NotificationEvent, RouteTableMap } from "../src/types.js";

// ════════════════════════════════════════════════════════
// RouteTable 测试
// ════════════════════════════════════════════════════════

describe("RouteTable", () => {
  let table: RouteTable;

  beforeEach(() => {
    table = new RouteTable();
  });

  it("load 批量加载路由", () => {
    table.load({
      alert: { channel: NotificationChannel.Urgent, ackRequired: true },
      review: { channel: NotificationChannel.Important, ackRequired: false },
    });
    expect(table.size).toBe(2);
    expect(table.eventTypes()).toContain("alert");
  });

  it("register 注册单条路由", () => {
    table.register("build", { channel: NotificationChannel.Routine, ackRequired: false });
    expect(table.size).toBe(1);
    expect(table.resolve("build").channel).toBe(NotificationChannel.Routine);
  });

  it("resolve 显式路由 → 精确命中", () => {
    table.register("code_changed", { channel: NotificationChannel.Routine, ackRequired: false });
    const route = table.resolve("code_changed");
    expect(route.channel).toBe(NotificationChannel.Routine);
    expect(route.ackRequired).toBe(false);
  });

  it("resolve 未注册事件 → fallback 到 Info 通道", () => {
    const route = table.resolve("unknown_event");
    expect(route.channel).toBe(NotificationChannel.Info);
    expect(route.ackRequired).toBe(false);
  });

  it("snapshot → 返回路由表快照（深拷贝）", () => {
    table.register("evt", { channel: NotificationChannel.Important, ackRequired: true });
    const snap = table.snapshot();
    expect(snap.evt.channel).toBe(NotificationChannel.Important);
    // 修改快照不影响原始
    snap.evt.channel = NotificationChannel.Routine;
    expect(table.resolve("evt").channel).toBe(NotificationChannel.Important);
  });

  it("eventTypes → 返回所有已注册事件类型", () => {
    table.load({
      a: { channel: NotificationChannel.Routine, ackRequired: false },
      b: { channel: NotificationChannel.Important, ackRequired: false },
    });
    expect(table.eventTypes()).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("重复注册 → 覆盖旧值", () => {
    table.register("evt", { channel: NotificationChannel.Routine, ackRequired: false });
    table.register("evt", { channel: NotificationChannel.Urgent, ackRequired: true });
    expect(table.resolve("evt").channel).toBe(NotificationChannel.Urgent);
  });

  // P0-1: 命名统一——routeTable key 为 snake_case，生产事件为 dotted PipelineEventType 值
  it("resolve dotted 事件名 → 取点号最后一段查表", () => {
    table.load({
      amendment_proposed: { channel: NotificationChannel.Urgent, ackRequired: true },
    });
    // "governance.amendment_proposed" → 取 "amendment_proposed" → urgent
    const route = table.resolve("governance.amendment_proposed");
    expect(route.channel).toBe(NotificationChannel.Urgent);
    expect(route.ackRequired).toBe(true);
    // has() 同步识别 dotted 命中
    expect(table.has("governance.amendment_proposed")).toBe(true);
  });

  it("resolve dotted 事件名未注册 → fallback Info + has() 为 false", () => {
    const route = table.resolve("governance.unknown_thing");
    expect(route.channel).toBe(NotificationChannel.Info);
    expect(table.has("governance.unknown_thing")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════
// 通道测试
// ════════════════════════════════════════════════════════

function makeEvent(overrides?: Partial<NotificationEvent>): NotificationEvent {
  return {
    type: "test_event",
    channel: NotificationChannel.Routine,
    ackRequired: false,
    requestId: `req-${Math.random().toString(36).slice(2, 7)}`,
    summary: "测试通知",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("UrgentChannel（紧急通道）", () => {
  it("push → 插队到队首 + 立即通知", () => {
    const ch = new UrgentChannel();
    const handler = vi.fn();
    ch.on(handler);

    ch.push(makeEvent({ requestId: "first" }));
    ch.push(makeEvent({ requestId: "second" }));

    // 插队：second 在队首
    expect(handler).toHaveBeenCalledTimes(2);
    expect(ch.backlog).toBe(2);
  });

  it("ack → 确认成功从队列移除", () => {
    const ch = new UrgentChannel();
    const evt = makeEvent({ requestId: "ack-me" });
    ch.push(evt);

    expect(ch.ack("ack-me")).toBe(true);
    expect(ch.backlog).toBe(0);
  });

  it("ack 不存在的 requestId → false", () => {
    const ch = new UrgentChannel();
    expect(ch.ack("nonexistent")).toBe(false);
  });

  it("超过 maxQueueSize → 丢弃最旧事件", () => {
    const ch = new UrgentChannel();
    // Urgent 默认 max 100
    for (let i = 0; i < 101; i++) {
      ch.push(makeEvent({ requestId: `req-${i}` }));
    }
    expect(ch.backlog).toBeLessThanOrEqual(100);
  });

  it("强制设置 ackRequired = true", () => {
    const ch = new UrgentChannel();
    const evt = makeEvent({ ackRequired: false });
    ch.push(evt);
    expect(evt.ackRequired).toBe(true);
    expect(evt.channel).toBe(NotificationChannel.Urgent);
  });
});

describe("ImportantChannel（重要通道）", () => {
  it("push → FIFO + 通知订阅者", () => {
    const ch = new ImportantChannel();
    const handler = vi.fn();
    ch.on(handler);

    ch.push(makeEvent({ requestId: "first" }));
    ch.push(makeEvent({ requestId: "second" }));

    expect(handler).toHaveBeenCalledTimes(2);
    expect(ch.backlog).toBe(2);
  });

  it("dequeue → FIFO 出队", () => {
    const ch = new ImportantChannel();
    ch.push(makeEvent({ requestId: "first", type: "a" }));
    ch.push(makeEvent({ requestId: "second", type: "b" }));

    const first = ch.dequeue();
    expect(first?.type).toBe("a");
    expect(ch.backlog).toBe(1);

    const second = ch.dequeue();
    expect(second?.type).toBe("b");
    expect(ch.backlog).toBe(0);
  });

  it("超过 maxQueueSize → 移除最旧事件", () => {
    const ch = new ImportantChannel();
    for (let i = 0; i < 501; i++) {
      ch.push(makeEvent({ requestId: `req-${i}` }));
    }
    expect(ch.backlog).toBeLessThanOrEqual(500);
  });
});

describe("RoutineChannel（例行通道）", () => {
  it("push → FIFO 纯内存", () => {
    const ch = new RoutineChannel();
    const handler = vi.fn();
    ch.on(handler);

    ch.push(makeEvent());
    expect(handler).toHaveBeenCalledOnce();
    expect(ch.backlog).toBe(1);
  });

  it("getConfig → 返回通道配置（副本）", () => {
    const ch = new RoutineChannel();
    const cfg = ch.getConfig();
    expect(cfg.channel).toBe(NotificationChannel.Routine);
    expect(cfg.persist).toBe(false);
    expect(cfg.failureMode).toBe("log");
  });
});

describe("InfoChannel（信息通道）", () => {
  it("push → 仅通知订阅者，不排队", () => {
    const ch = new InfoChannel();
    const handler = vi.fn();
    ch.on(handler);

    ch.push(makeEvent());
    expect(handler).toHaveBeenCalledOnce();
    expect(ch.backlog).toBe(0); // 永无积压
  });

  it("无订阅者 → 静默丢弃", () => {
    const ch = new InfoChannel();
    // 不订阅，push 不应抛出异常
    expect(() => ch.push(makeEvent())).not.toThrow();
    expect(ch.backlog).toBe(0);
  });
});

// ════════════════════════════════════════════════════════
// NotificationPipe 集成测试
// ════════════════════════════════════════════════════════

describe("NotificationPipe", () => {
  let pipe: NotificationPipe;

  beforeEach(() => {
    pipe = new NotificationPipe();
  });

  describe("路由与推送", () => {
    it("push → 按事件类型路由到正确通道", () => {
      pipe.loadRoutes({
        code_changed: { channel: NotificationChannel.Routine, ackRequired: false },
        alert: { channel: NotificationChannel.Urgent, ackRequired: true },
      });

      const routineHandler = vi.fn();
      pipe.on(NotificationChannel.Routine, routineHandler);

      pipe.push({ type: "code_changed", summary: "代码变更" });
      expect(routineHandler).toHaveBeenCalledOnce();
      expect(routineHandler.mock.calls[0][0].channel).toBe(NotificationChannel.Routine);
    });

    it("push 未注册事件 → 走 Info 默认通道", () => {
      const infoHandler = vi.fn();
      pipe.on(NotificationChannel.Info, infoHandler);

      pipe.push({ type: "unknown_event", summary: "未知事件" });
      expect(infoHandler).toHaveBeenCalledOnce();
    });

    it("registerRoute → 动态注册单条路由", () => {
      pipe.registerRoute("dynamic_event", {
        channel: NotificationChannel.Important,
        ackRequired: false,
      });

      const importantHandler = vi.fn();
      pipe.on(NotificationChannel.Important, importantHandler);

      pipe.push({ type: "dynamic_event", summary: "动态路由" });
      expect(importantHandler).toHaveBeenCalledOnce();
    });

    it("补全 requestId + timestamp", () => {
      pipe.loadRoutes({
        test: { channel: NotificationChannel.Routine, ackRequired: false },
      });

      const handler = vi.fn();
      pipe.on(NotificationChannel.Routine, handler);

      const before = Date.now();
      pipe.push({ type: "test" });
      const after = Date.now();

      const event = handler.mock.calls[0][0] as NotificationEvent;
      expect(event.requestId).toBeDefined();
      expect(event.requestId).toMatch(/^notif-/);
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });

    // P0-1: push 语义——调用方显式设置 channel/ackRequired 时不被空路由覆盖
    it("push 未命中路由且调用方显式设 channel → 保留调用方语义（DECISION_REQUIRED → Urgent）", () => {
      const urgentHandler = vi.fn();
      pipe.on(NotificationChannel.Urgent, urgentHandler);

      // 路由表为空——resolve 到 DEFAULT_ROUTE（Info），但调用方已显式设置 Urgent
      pipe.push({
        type: "governance.some_decision",
        summary: "需要决策",
        channel: NotificationChannel.Urgent,
        ackRequired: true,
      });

      expect(urgentHandler).toHaveBeenCalledOnce();
      const evt = urgentHandler.mock.calls[0][0] as NotificationEvent;
      expect(evt.channel).toBe(NotificationChannel.Urgent);
      expect(evt.ackRequired).toBe(true);
    });

    // P0-1: 显式路由命中 → 路由覆盖调用方（如 event-routing.json 的 amendment_proposed → urgent）
    it("bootstrap 链路：governance.amendment_proposed 经路由表走 Urgent 通道", () => {
      // 模拟 bootstrap 的 loadRoutes(config.eventRouting.routeTable)——含 amendment_proposed
      pipe.loadRoutes({
        amendment_proposed: { channel: NotificationChannel.Urgent, ackRequired: true },
        code_changed: { channel: NotificationChannel.Routine, ackRequired: false },
      });

      const urgentHandler = vi.fn();
      const routineHandler = vi.fn();
      pipe.on(NotificationChannel.Urgent, urgentHandler);
      pipe.on(NotificationChannel.Routine, routineHandler);

      // 生产事件为 dotted PipelineEventType 值
      pipe.push({ type: "governance.amendment_proposed", summary: "修宪提案" });

      expect(urgentHandler).toHaveBeenCalledOnce();
      expect(routineHandler).not.toHaveBeenCalled();
      const evt = urgentHandler.mock.calls[0][0] as NotificationEvent;
      expect(evt.channel).toBe(NotificationChannel.Urgent);
      expect(evt.ackRequired).toBe(true);
    });
  });

  describe("确认 flow", () => {
    it("ack urgent 事件 → 调用 ack 回调", () => {
      pipe.loadRoutes({
        alert: { channel: NotificationChannel.Urgent, ackRequired: true },
      });

      const ackHandler = vi.fn();
      pipe.onAck(ackHandler);

      pipe.push({ type: "alert", summary: "紧急通知" });

      const routeSnap = pipe.routeSnapshot();
      // 先确认事件存在（通过 backlog）
      const backlogs = pipe.backlogs();
      expect(backlogs[NotificationChannel.Urgent]).toBe(1);
    });

    it("onAck 注册回调", () => {
      const handler = vi.fn();
      pipe.onAck(handler);

      // 验证回调注册不报错
      expect(handler).not.toHaveBeenCalled(); // 未推送事件时不应调用
    });
  });

  describe("订阅管理", () => {
    it("on → 按通道订阅 + off → 移除订阅", () => {
      pipe.registerRoute("hello", { channel: NotificationChannel.Routine, ackRequired: false });
      const handler = vi.fn();
      pipe.on(NotificationChannel.Routine, handler);
      pipe.push({ type: "hello", summary: "你好" });

      expect(handler).toHaveBeenCalledOnce();

      pipe.off(NotificationChannel.Routine, handler);
      pipe.push({ type: "hello", summary: "再见" });
      expect(handler).toHaveBeenCalledTimes(1); // off 后不再递增
    });

    it("onAll → 订阅四个通道", () => {
      const handler = vi.fn();
      pipe.onAll(handler);

      pipe.loadRoutes({
        urgent_evt: { channel: NotificationChannel.Urgent, ackRequired: true },
        important_evt: { channel: NotificationChannel.Important, ackRequired: false },
        routine_evt: { channel: NotificationChannel.Routine, ackRequired: false },
        info_evt: { channel: NotificationChannel.Info, ackRequired: false },
      });

      pipe.push({ type: "urgent_evt" });
      pipe.push({ type: "important_evt" });
      pipe.push({ type: "routine_evt" });
      pipe.push({ type: "info_evt" });

      expect(handler).toHaveBeenCalledTimes(4);
    });
  });

  describe("归并缓冲", () => {
    it("setMergeRules → 事件同 mergeKey 进入缓冲区", () => {
      pipe.loadRoutes({
        code_changed: {
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

      // push 3 个同 mergeKey 事件（maxBatch=3）
      pipe.push({ type: "code_changed", summary: "变更1", mergeKey: "abc123" });
      pipe.push({ type: "code_changed", summary: "变更2", mergeKey: "abc123" });
      pipe.push({ type: "code_changed", summary: "变更3", mergeKey: "abc123" });

      // 达到 maxBatch(3) 自动 flush → 归并通知
      expect(handler).toHaveBeenCalled();
      const mergedEvent = handler.mock.calls[0][0] as NotificationEvent;
      expect(mergedEvent.summary).toContain("归并");
      expect(mergedEvent.summary).toContain("3");
    });

    it("flushMerged → 手动触发归并 flush", () => {
      pipe.loadRoutes({
        code_changed: {
          channel: NotificationChannel.Routine,
          ackRequired: false,
          mergeKey: "commitHash",
        },
      });

      pipe.setMergeRules([
        { groupBy: "mergeKey", windowMs: 0, maxBatch: 10 }, // windowMs=0 立即过期
      ]);

      const handler = vi.fn();
      pipe.on(NotificationChannel.Routine, handler);

      pipe.push({ type: "code_changed", summary: "变更1", mergeKey: "def456" });
      pipe.push({ type: "code_changed", summary: "变更2", mergeKey: "def456" });

      // 手动 flush（windowMs=0 过期）
      pipe.flushMerged();

      expect(handler).toHaveBeenCalled();
      const mergedEvent = handler.mock.calls[0][0] as NotificationEvent;
      expect(mergedEvent.summary).toContain("归并");
    });
  });

  describe("状态查询", () => {
    it("backlogs → 返回各通道积压量", () => {
      pipe.loadRoutes({
        urgent_evt: { channel: NotificationChannel.Urgent, ackRequired: true },
        important_evt: { channel: NotificationChannel.Important, ackRequired: false },
      });

      pipe.push({ type: "urgent_evt" });
      pipe.push({ type: "urgent_evt" });
      pipe.push({ type: "important_evt" });

      const bl = pipe.backlogs();
      expect(bl[NotificationChannel.Urgent]).toBe(2);
      expect(bl[NotificationChannel.Important]).toBe(1);
      expect(bl[NotificationChannel.Routine]).toBe(0);
      expect(bl[NotificationChannel.Info]).toBe(0);
    });

    it("routeSnapshot → 返回当前路由表快照", () => {
      pipe.loadRoutes({
        a: { channel: NotificationChannel.Routine, ackRequired: false },
      });
      pipe.registerRoute("b", { channel: NotificationChannel.Important, ackRequired: false });

      const snap = pipe.routeSnapshot();
      expect(snap.a.channel).toBe(NotificationChannel.Routine);
      expect(snap.b.channel).toBe(NotificationChannel.Important);
    });
  });
});

// ════════════════════════════════════════════════════════
// DEFAULT_CHANNEL_CONFIGS 验证
// ════════════════════════════════════════════════════════

describe("DEFAULT_CHANNEL_CONFIGS", () => {
  it("四个通道配置齐全", () => {
    const channels = [
      NotificationChannel.Urgent,
      NotificationChannel.Important,
      NotificationChannel.Routine,
      NotificationChannel.Info,
    ];
    for (const ch of channels) {
      expect(DEFAULT_CHANNEL_CONFIGS[ch]).toBeDefined();
    }
  });

  it("Urgent: persist=true, failureMode=escalate", () => {
    const cfg = DEFAULT_CHANNEL_CONFIGS[NotificationChannel.Urgent];
    expect(cfg.persist).toBe(true);
    expect(cfg.failureMode).toBe("escalate");
    expect(cfg.maxQueueSize).toBe(100);
  });

  it("Important: persist=true, failureMode=retry", () => {
    const cfg = DEFAULT_CHANNEL_CONFIGS[NotificationChannel.Important];
    expect(cfg.persist).toBe(true);
    expect(cfg.failureMode).toBe("retry");
    expect(cfg.maxQueueSize).toBe(500);
  });

  it("Routine: persist=false, failureMode=log", () => {
    const cfg = DEFAULT_CHANNEL_CONFIGS[NotificationChannel.Routine];
    expect(cfg.persist).toBe(false);
    expect(cfg.failureMode).toBe("log");
    expect(cfg.maxQueueSize).toBe(1000);
  });

  it("Info: persist=false, failureMode=drop, maxQueue=0", () => {
    const cfg = DEFAULT_CHANNEL_CONFIGS[NotificationChannel.Info];
    expect(cfg.persist).toBe(false);
    expect(cfg.failureMode).toBe("drop");
    expect(cfg.maxQueueSize).toBe(0);
  });
});
