import { describe, it, expect } from "vitest";
import { AgentPool } from "../src/agent-pool";
import { AgentType, ToolCategory } from "@cortex/shared";

describe("AgentPool", () => {
  it("spawn 在配额内返回 true", () => {
    const pool = new AgentPool();
    pool.register({
      type: AgentType.Code,
      allowedTools: [ToolCategory.Read, ToolCategory.Write],
      maxInstances: 2,
    });
    expect(pool.spawn(AgentType.Code, "inst-1")).toBe(true);
    expect(pool.count(AgentType.Code)).toBe(1);
  });

  it("超配额 spawn 返回 false", () => {
    const pool = new AgentPool();
    pool.register({
      type: AgentType.Code,
      allowedTools: [ToolCategory.Read, ToolCategory.Write],
      maxInstances: 1,
    });
    pool.spawn(AgentType.Code, "inst-1");
    expect(pool.spawn(AgentType.Code, "inst-2")).toBe(false);
  });

  it("destroy 回收配额后可再 spawn", () => {
    const pool = new AgentPool();
    pool.register({
      type: AgentType.Code,
      allowedTools: [ToolCategory.Read],
      maxInstances: 1,
    });
    pool.spawn(AgentType.Code, "inst-1");
    pool.destroy(AgentType.Code, "inst-1");
    expect(pool.spawn(AgentType.Code, "inst-2")).toBe(true);
  });

  it("未注册的 Agent 类型 spawn 返回 false", () => {
    const pool = new AgentPool();
    expect(pool.spawn(AgentType.Review, "inst-1")).toBe(false);
  });
});
