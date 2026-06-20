import { describe, it, expect } from "vitest";
import { validateAllConfigs, validateConfigDomain } from "../src/index.js";

describe("Config validation", () => {
  it("合法 agents 配置通过校验", () => {
    expect(() => validateConfigDomain("agents", [
      { id: "a1", type: "code", name: "test" },
    ])).not.toThrow();
  });

  it("非数组 agents 配置抛 ConfigValidationError", () => {
    expect(() => validateConfigDomain("agents", { id: "invalid" })).toThrow(
      "agents 必须是数组",
    );
  });

  it("合法 engine 配置通过校验（空配置也可通过）", () => {
    expect(() => validateConfigDomain("engine", {})).not.toThrow();
  });

  it("validateAllConfigs 校验不存在的域跳过", () => {
    expect(() => validateAllConfigs({})).not.toThrow();
  });

  it("validateAllConfigs 校验完整配置", () => {
    expect(() => validateAllConfigs({
      agents: [] as any,
      engine: {},
    } as any)).not.toThrow();
  });
});
