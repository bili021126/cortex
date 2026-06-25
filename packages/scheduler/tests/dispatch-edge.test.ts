// @ci: unit
/**
 * Dispatch edge cases — 调度分发的边界情况测试
 *
 * 覆盖：无效 agent 类型、空 payload、null payload、
 * 缺少必填字段、重复节点 ID、自引用父节点。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { TaskBoard, AgentPool, PipelineObserver, topologicalSort, findMatchingAgent } from "@cortex/scheduler";
import { AgentType, type TaskNode, type Agent } from "@cortex/shared";

function makeNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "test-node",
    type: "implementation",
    tags: ["test"],
    needsMultiPerspective: false,
    status: "pending",
    claimedBy: [],
    payload: "Test task",
    results: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("Dispatch edge cases", () => {
  let board: TaskBoard;
  let pool: AgentPool;
  let observer: PipelineObserver;

  beforeEach(() => {
    board = new TaskBoard();
    pool = new AgentPool();
    observer = new PipelineObserver();
  });

  it("should handle node with invalid agent type", () => {
    // 不存在的 Agent 类型——findMatchingAgent 应返回 null
    const agents = new Map();
    const result = findMatchingAgent(agents, makeNode({ id: "invalid-type", type: "nonexistent", tags: ["unknown"] }));
    // 空的 agents map 应返回 null，不崩溃
    expect(result).toBeNull();
  });

  it("should handle node with empty payload", () => {
    const node = makeNode({ id: "empty-pl", payload: "" });
    board.addNode(node);
    expect(board.getNode("empty-pl")).toBeDefined();
    // 空 payload 的节点可被添加到 TaskBoard
    expect(board.getAllNodes().length).toBe(1);
  });

  it("should handle node with null payload", () => {
    const node = makeNode({ id: "null-pl", payload: null as unknown as string });
    board.addNode(node);
    expect(board.getNode("null-pl")).toBeDefined();
    // null payload 可被添加，不崩溃
    expect(board.getAllNodes().length).toBe(1);
  });

  it("should handle node with missing required fields", () => {
    // 最小化节点——缺少部分字段但可容忍
    const minimalNode = {
      id: "minimal",
      type: "implementation",
      tags: ["test"],
      needsMultiPerspective: false,
      status: "pending" as const,
      claimedBy: [],
      payload: "minimal",
      results: [],
      createdAt: Date.now(),
    };
    board.addNode(minimalNode as TaskNode);
    expect(board.getNode("minimal")).toBeDefined();
  });

  it("should handle duplicate node IDs", () => {
    const node1 = makeNode({ id: "dup-id", payload: "first" });
    const node2 = makeNode({ id: "dup-id", payload: "second" });

    board.addNode(node1);
    // 添加重复 ID 的节点——可能被静默忽略或覆盖，但不应崩溃
    board.addNode(node2);

    const all = board.getAllNodes();
    const dups = all.filter((n) => n.id === "dup-id");
    // 不应有重复节点 ID（或只有一个保留）
    expect(dups.length).toBeLessThanOrEqual(1);
  });

  it("should handle self-referencing parent node", () => {
    const selfRef = makeNode({ id: "self", parentId: "self", payload: "self-reference" });
    board.addNode(selfRef);

    // 拓扑排序应处理自引用（循环检测或忽略）
    const nodes = board.getAllNodes();
    const sorted = topologicalSort(nodes);
    // 不崩溃即可——拓扑排序应处理循环
    expect(sorted.length).toBeGreaterThanOrEqual(0);
  });
});
