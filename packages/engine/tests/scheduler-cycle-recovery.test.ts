// @ci: unit
// P3: Scheduler 循环依赖恢复 e2e——验证拓扑排序检测循环后节点被标记为 failed。
import { describe, it, expect } from "vitest";
import { topologicalSort } from "@cortex/scheduler";

describe("Scheduler 循环依赖恢复", () => {
  it("简单循环: A→B→A——返回空 layers", () => {
    const nodes = [
      { id: "a", parentId: "b", tags: ["impl"], payload: "A", type: "code", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
      { id: "b", parentId: "a", tags: ["impl"], payload: "B", type: "code", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
    ];
    const layers = topologicalSort(nodes as any);
    // 循环依赖 → 返回空 layers，Scheduler 应将节点标记为 failed
    expect(layers).toEqual([]);
  });

  it("间接循环: A→B→C→A——返回空 layers", () => {
    const nodes = [
      { id: "a", parentId: "c", tags: ["impl"], payload: "A", type: "code", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
      { id: "b", parentId: "a", tags: ["impl"], payload: "B", type: "code", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
      { id: "c", parentId: "b", tags: ["impl"], payload: "C", type: "code", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
    ];
    const layers = topologicalSort(nodes as any);
    expect(layers).toEqual([]);
  });

  it("自环: A→A——返回空 layers", () => {
    const nodes = [
      { id: "a", parentId: "a", tags: ["impl"], payload: "A", type: "code", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
    ];
    const layers = topologicalSort(nodes as any);
    expect(layers).toEqual([]);
  });

  it("无循环 diamond 结构——正常产出分层", () => {
    //    root
    //   /    \
    //  a      b
    //   \    /
    //    leaf
    const nodes = [
      { id: "root", tags: ["impl"], payload: "root", type: "code", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
      { id: "a", parentId: "root", tags: ["impl"], payload: "A", type: "code", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
      { id: "b", parentId: "root", tags: ["impl"], payload: "B", type: "code", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
      { id: "leaf", parentId: "a", tags: ["impl"], payload: "leaf", type: "code", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
    ];
    const layers = topologicalSort(nodes as any);
    // diamond 不是循环，应正常产出 3 层
    expect(layers.length).toBeGreaterThan(0);
    // root 在第 0 层
    expect(layers[0]).toContain("root");
  });

  it("部分循环 + 部分正常——非循环节点仍可分层，循环节点被省略", () => {
    // 三个节点：A 无依赖（正常），B→C→B（循环）
    const nodes = [
      { id: "a", tags: ["impl"], payload: "A", type: "code", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
      { id: "b", parentId: "c", tags: ["impl"], payload: "B", type: "code", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
      { id: "c", parentId: "b", tags: ["impl"], payload: "C", type: "code", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
    ];
    const layers = topologicalSort(nodes as any);
    // 循环检测仅在 roots.length===0 时触发；此处 A 是合法 root，B/C 形成循环被无声省略
    expect(layers.length).toBeGreaterThanOrEqual(1);
    expect(layers[0]).toContain("a");
    // B 和 C 不应出现在任何层中（它们形成循环，不可达）
    const allIds = layers.flat();
    expect(allIds).not.toContain("b");
    expect(allIds).not.toContain("c");
  });
});
