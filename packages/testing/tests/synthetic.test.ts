// @ci: unit
import { describe, it, expect } from "vitest";
import { AgentType, MemoryType, MemoryState } from "@cortex/shared";
import {
  syntheticTaskNode,
  syntheticTaskTree,
  generateSyntheticMemories,
  generateMemoriesWithStates,
} from "../src/index.js";

describe("syntheticTaskNode", () => {
  it("默认生成 valid TaskNode", () => {
    const node = syntheticTaskNode();
    expect(node.id).toBeTruthy();
    expect(node.type).toBe("implementation");
    expect(node.status).toBe("pending");
    expect(node.payload).toBe("合成任务: 实现示例功能");
    expect(node.needsMultiPerspective).toBe(false);
    expect(node.claimedBy).toEqual([]);
    expect(node.results).toEqual([]);
    expect(node.createdAt).toBeTypeOf("number");
  });

  it("overrides 覆盖默认值", () => {
    const node = syntheticTaskNode({
      type: "research",
      payload: "自定义",
      needsMultiPerspective: true,
      status: "running",
    });
    expect(node.type).toBe("research");
    expect(node.payload).toBe("自定义");
    expect(node.needsMultiPerspective).toBe(true);
    expect(node.status).toBe("running");
  });

  it("每次生成唯一 id", () => {
    const a = syntheticTaskNode();
    const b = syntheticTaskNode();
    expect(a.id).not.toBe(b.id);
  });
});

describe("syntheticTaskTree", () => {
  it("生成指定数量的节点", () => {
    const nodes = syntheticTaskTree(5);
    expect(nodes).toHaveLength(5);
  });

  it("子节点 parentId 指向前一个节点", () => {
    const nodes = syntheticTaskTree(3);
    expect(nodes[0].parentId).toBeUndefined();
    expect(nodes[1].parentId).toBe(nodes[0].id);
    expect(nodes[2].parentId).toBe(nodes[1].id);
  });

  it("传入 parentId 作为根节点 parent", () => {
    const nodes = syntheticTaskTree(2, "root-1");
    expect(nodes[0].parentId).toBe("root-1");
  });

  it("3 种类型轮换", () => {
    const nodes = syntheticTaskTree(6);
    expect(nodes[0].type).toBe("research");
    expect(nodes[1].type).toBe("implementation");
    expect(nodes[2].type).toBe("test");
    expect(nodes[3].type).toBe("research");
  });
});

describe("generateSyntheticMemories", () => {
  it("生成指定数量", () => {
    const mems = generateSyntheticMemories(3);
    expect(mems).toHaveLength(3);
  });

  it("默认类型为 Episodic", () => {
    const mems = generateSyntheticMemories(2);
    for (const m of mems) {
      expect(m.memoryType).toBe(MemoryType.Episodic);
      expect(typeof m.summary).toBe("string");
      expect(Object.values(AgentType)).toContain(m.agentType);
    }
  });

  it("支持 Knowledge 类型", () => {
    const mems = generateSyntheticMemories(2, MemoryType.Knowledge);
    expect(mems).toHaveLength(2);
    for (const m of mems) {
      expect(m.memoryType).toBe(MemoryType.Knowledge);
    }
  });
});

describe("generateMemoriesWithStates", () => {
  it("active + archived 数量正确", () => {
    const result = generateMemoriesWithStates(2, 3);
    expect(result).toHaveLength(5);
    expect(result.filter((r) => r.state === MemoryState.Active)).toHaveLength(2);
    expect(result.filter((r) => r.state === MemoryState.Archived)).toHaveLength(3);
  });

  it("零个 archived", () => {
    const result = generateMemoriesWithStates(3, 0);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.state === MemoryState.Active)).toBe(true);
  });
});
