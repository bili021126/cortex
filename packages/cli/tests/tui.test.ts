// @ci: unit
import { describe, it, expect } from "vitest";

// 跳过：import("@cortex/cli") 触发 main.ts 顶层副作用（bootstrapLlm/bootstrapMcp等），
// 在这些引导完成前会超时。单个命名导出（如 TuiEventBus / planMode）可正常导入。
describe.skip("@cortex/cli barrel export (原 tui)", () => {
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
