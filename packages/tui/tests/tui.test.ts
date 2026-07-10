// @ci: unit
import { describe, it, expect } from "vitest";

describe("@cortex/tui smoke", () => {
  it("barrel export 可导入", async () => {
    const mod = await import("@cortex/tui");
    expect(mod).toBeDefined();
  });

  it("TuiEventBus 可导入", async () => {
    const { TuiEventBus } = await import("@cortex/tui");
    expect(TuiEventBus).toBeDefined();
  });

  it("planMode 可导入", async () => {
    const { planMode } = await import("@cortex/tui");
    expect(planMode).toBeDefined();
  });

  it("tuiEventBus 实例可导入", async () => {
    const { tuiEventBus } = await import("@cortex/tui");
    expect(tuiEventBus).toBeDefined();
  });
});
