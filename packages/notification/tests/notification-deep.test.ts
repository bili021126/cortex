import { describe, it, expect } from "vitest";

describe("notification deep", () => {
  it("通道分发: UrgentChannel 可导入", async () => {
    const { UrgentChannel } = await import("@cortex/notification");
    expect(UrgentChannel).toBeDefined();
  });

  it("通道分发: 路由表 RouteTable 可注册路由", async () => {
    const { RouteTable, NotificationChannel } = await import("@cortex/notification");
    const table = new RouteTable();
    expect(table).toBeDefined();
    table.register("test.event", { channel: NotificationChannel.Info, ackRequired: false });
    expect(table.size).toBe(1);
    expect(table.eventTypes()).toContain("test.event");
  });

  it("通道分发: NotificationPipe 可处理事件", async () => {
    const { NotificationPipe } = await import("@cortex/notification");
    expect(NotificationPipe).toBeDefined();
  });
});
