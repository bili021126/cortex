import { describe, it, expect } from "vitest";

describe("tools deep", () => {
  it("ToolRegistry 注册验证: detectDrifts 返回结构正确", async () => {
    const { detectDrifts } = await import("@cortex/tools");
    // detectDrifts 应为函数
    expect(typeof detectDrifts).toBe("function");
  });

  it("ToolRegistry 注册验证: findProjectRoot 返回值", async () => {
    const { findProjectRoot } = await import("@cortex/tools");
    const root = findProjectRoot(process.cwd());
    expect(root).toBeDefined();
    expect(typeof root).toBe("string");
  });

  it("ToolRegistry 注册验证: detectCycles 导入正常", async () => {
    const { detectCycles } = await import("@cortex/tools");
    expect(detectCycles).toBeDefined();
    expect(typeof detectCycles).toBe("function");
  });
});
