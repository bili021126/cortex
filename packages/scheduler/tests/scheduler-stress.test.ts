// @ci: unit
// @cortex/scheduler — 大批量节点压力测试
//
// 验证 topologicalSort 在 100 个节点的 DAG 下正常运行。

import { describe, it, expect } from "vitest";
import { topologicalSort } from "@cortex/scheduler";
import type { TaskNode } from "@cortex/shared";

describe("scheduler大批量", () => {
  it("100个节点拓扑排序不崩", () => {
    // 构造一个 100 节点的链式 DAG: 0 → 1 → 2 → ... → 99
    const nodes: TaskNode[] = Array.from({ length: 100 }, (_, i) => ({
      id: `n${i}`,
      type: "default",
      agentType: "code" as any,
      parentId: i === 0 ? undefined : `n${i - 1}`,
      intent: `task ${i}`,
      status: "pending" as any,
      result: undefined,
      createdAt: Date.now(),
    }));

    const layers = topologicalSort(nodes);

    // 应产生 100 层（每个节点一层）
    expect(Array.isArray(layers)).toBe(true);
    expect(layers.length).toBe(100);

    // 每层恰好一个节点
    for (let i = 0; i < 100; i++) {
      expect(layers[i]).toEqual([`n${i}`]);
    }

    // 总节点数：100 层 × 1 = 100
    const total = layers.reduce((sum, layer) => sum + layer.length, 0);
    expect(total).toBe(100);
  });

  it("100个节点扇出拓扑不崩", () => {
    // 单根 + 99 个子节点（扇出）
    const nodes: TaskNode[] = [
      {
        id: "root",
        type: "default",
        agentType: "code" as any,
        parentId: undefined,
        intent: "root",
        status: "pending" as any,
        result: undefined,
        createdAt: Date.now(),
      },
      ...Array.from({ length: 99 }, (_, i) => ({
        id: `child-${i}`,
        type: "default" as const,
        agentType: "code" as any,
        parentId: "root",
        intent: `child ${i}`,
        status: "pending" as any,
        result: undefined,
        createdAt: Date.now(),
      })),
    ];

    const layers = topologicalSort(nodes);

    expect(Array.isArray(layers)).toBe(true);
    // 根在第 0 层，99 个子节点在第 1 层
    expect(layers.length).toBe(2);
    expect(layers[0]).toEqual(["root"]);
    expect(layers[1].length).toBe(99);
  });
});
