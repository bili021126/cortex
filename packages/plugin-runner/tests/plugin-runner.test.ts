// @ci: unit
import { describe, it, expect } from "vitest";

describe("@cortex/plugin-runner smoke", () => {
  it("barrel export 可导入", async () => {
    const mod = await import("@cortex/plugin-runner");
    expect(mod).toBeDefined();
  });

  it("PluginRunner 可导入", async () => {
    const { PluginRunner } = await import("@cortex/plugin-runner");
    expect(PluginRunner).toBeDefined();
  });

  it("PluginLoader 可导入", async () => {
    const { PluginLoader } = await import("@cortex/plugin-runner");
    expect(PluginLoader).toBeDefined();
  });
});
/**
 * @cortex/plugin-runner — 包级冒烟测试
 * @ci: unit
 */

import { describe, it, expect } from "vitest";

describe("@cortex/plugin-runner", () => {
  it("should be importable", async () => {
    const mod = await import("../src/index.js");
    expect(mod).toBeDefined();
    expect(mod.PluginRegistry).toBeInstanceOf(Function);
    expect(mod.PluginRunner).toBeInstanceOf(Function);
    expect(mod.PluginValidator).toBeInstanceOf(Function);
    expect(mod.AbstractPlugin).toBeInstanceOf(Function);
    expect(mod.isPlugin).toBeInstanceOf(Function);
    expect(mod.PluginRunnerPlugin).toBeInstanceOf(Function);
  });
});
