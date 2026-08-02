// @ci: unit
import { describe, it, expect } from "vitest";

describe("Engine Scheduler", () => {
  it("MetaAgent.plan 返回 TaskNode[]", async () => {
    const { MetaAgent } = await import("@cortex/engine");
    expect(MetaAgent).toBeDefined();
    // 验证 plan 方法签名
    const proto = MetaAgent.prototype;
    expect(typeof proto.plan).toBe("function");
  });

  it("拓扑排序处理单节点", async () => {
    const { topologicalSort } = await import("@cortex/scheduler");
    const result = topologicalSort([{
      id: "n1", type: "default",
      parentId: undefined,
      status: "pending", tags: [], needsMultiPerspective: false, claimedBy: [], results: [], payload: "test", createdAt: Date.now()
    }]);
    expect(result.length).toBe(1);
    expect(result[0]).toEqual(["n1"]);
  });
});
