// @ci: unit
import { describe, it, expect } from "vitest";

describe("testing deep", () => {
  it("synthetic数据: syntheticTaskNode 生成完整结构", async () => {
    const { syntheticTaskNode } = await import("@cortex/testing");
    const node = syntheticTaskNode({ id: "test-1", payload: "custom payload" });
    expect(node.id).toBe("test-1");
    expect(node.payload).toBe("custom payload");
    expect(node.status).toBe("pending");
    expect(node.type).toBe("implementation");
  });

  it("synthetic数据: syntheticTaskTree 生成链式结构", async () => {
    const { syntheticTaskTree } = await import("@cortex/testing");
    const tree = syntheticTaskTree(3);
    expect(tree.length).toBe(3);
    // 链式 parentId
    expect(tree[1]!.parentId).toBe(tree[0]!.id);
    expect(tree[2]!.parentId).toBe(tree[1]!.id);
  });

  it("synthetic数据: generateSyntheticMemories 生成指定数量", async () => {
    const { generateSyntheticMemories } = await import("@cortex/testing");
    const memories = generateSyntheticMemories(5, "TaskLog");
    expect(memories.length).toBe(5);
    expect(memories[0]!.kind).toBe("TaskLog");
    expect(memories[0]!.summary).toBeDefined();
  });

  it("synthetic数据: generateMemoriesWithStates 包含状态", async () => {
    const { generateMemoriesWithStates } = await import("@cortex/testing");
    const items = generateMemoriesWithStates(2, 1);
    expect(items.length).toBe(3);
    const activeItems = items.filter((i) => i.state === "Active");
    const archivedItems = items.filter((i) => i.state === "Archived");
    expect(activeItems.length).toBe(2);
    expect(archivedItems.length).toBe(1);
  });
});
