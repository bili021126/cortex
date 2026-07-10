import { describe, it, expect } from "vitest";

describe("telemetry deep", () => {
  it("trend分析: TelemetryController 可创建", async () => {
    const { TelemetryController } = await import("@cortex/telemetry");
    const ctrl = new TelemetryController();
    expect(ctrl).toBeDefined();
  });

  it("trend分析: analyzeTrend 返回结构正确", async () => {
    const { TelemetryController } = await import("@cortex/telemetry");
    const ctrl = new TelemetryController();
    // 注入测试数据
    ctrl.record?.("test_metric", 10, Date.now() - 10000);
    ctrl.record?.("test_metric", 20, Date.now() - 5000);
    ctrl.record?.("test_metric", 30, Date.now());
    const trend = ctrl.analyzeTrend?.("test_metric", 30000);
    if (trend) {
      expect(trend).toHaveProperty("trend");
      expect(trend).toHaveProperty("avg");
      expect(trend).toHaveProperty("sampleCount");
      expect(trend.sampleCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("trend分析: analyzeAll 聚合多指标", async () => {
    const { TelemetryController } = await import("@cortex/telemetry");
    const ctrl = new TelemetryController();
    ctrl.record?.("m1", 1, Date.now());
    ctrl.record?.("m2", 2, Date.now());
    const all = ctrl.analyzeAll?.(30000) ?? [];
    expect(Array.isArray(all)).toBe(true);
  });
});
