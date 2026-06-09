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
