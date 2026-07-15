// @ci: unit
import { describe, it, expect } from "vitest";

describe("@cortex/tui smoke", () => {
  it("barrel export 可导入", async () => {
    const mod = await import("@cortex/cli");
    expect(mod).toBeDefined();
  });

  it("TuiEventBus 可导入", async () => {
    const { TuiEventBus } = await import("@cortex/cli");
    expect(TuiEventBus).toBeDefined();
  });

  it("planMode 可导入", async () => {
    const { planMode } = await import("@cortex/cli");
    expect(planMode).toBeDefined();
  });

  it("tuiEventBus 实例可导入", async () => {
    const { tuiEventBus } = await import("@cortex/cli");
    expect(tuiEventBus).toBeDefined();
  });
});
