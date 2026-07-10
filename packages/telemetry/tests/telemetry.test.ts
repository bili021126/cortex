// @ci: unit
import { describe, it, expect } from "vitest";

describe("@cortex/telemetry smoke", () => {
  it("barrel export 可导入", async () => {
    const mod = await import("@cortex/telemetry");
    expect(mod).toBeDefined();
  });

  it("TelemetryController 可导入", async () => {
    const { TelemetryController } = await import("@cortex/telemetry");
    expect(TelemetryController).toBeDefined();
  });

  it("TelemetryLevel 可导入", async () => {
    const { TelemetryLevel } = await import("@cortex/telemetry");
    expect(TelemetryLevel).toBeDefined();
  });

  it("telemetryController 单例可导入", async () => {
    const { telemetryController } = await import("@cortex/telemetry");
    expect(telemetryController).toBeDefined();
  });
});
