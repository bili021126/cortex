/**
 * @cortex/scheduler - E2E integration tests
 * Covers: TaskBoard -> topologicalSort -> AgentPool -> PipelineObserver
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  TaskBoard, AgentPool, topologicalSort, PipelineObserver,
  TagMatchingStrategy, TopologicalLayeredDriver,
  PipelineModel, FixedModelRouter,
} from "../src/index.js";
import { AgentType as AT, PipelinePriority, PipelineEventType } from "../../shared/src/index.js";
import type { TaskNode } from "../../shared/src/index.js";

function tn(id: string, overrides?: Partial<TaskNode>): TaskNode {
  return { id, type: "implementation", tags: ["implementation"], status: "pending", claimedBy: [], payload: `Task ${id}`, results: [], needsMultiPerspective: false, createdAt: Date.now(), ...overrides };
}

describe("TaskBoard", () => {
  let board: TaskBoard;
  beforeEach(() => { board = new TaskBoard(); });

  it("addNode + getNode + getPendingNodes", () => {
    board.addNode(tn("a")); board.addNode(tn("b"));
    expect(board.getNode("a")).toBeDefined();
    expect(board.getPendingNodes().length).toBe(2);
  });

  it("claim + complete lifecycle", () => {
    board.addNode(tn("n1"));
    const claimed = board.claim("n1", AT.Code);
    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe("claimed");

    board.complete("n1", AT.Code, true, "done");
    expect(board.getNode("n1")?.status === "done").toBe(true);
  });

  it("removeSubtree removes descendants", () => {
    board.addNode(tn("root"));
    board.addNode(tn("child", { parentId: "root" }));
    board.addNode(tn("gc", { parentId: "child" }));
    board.removeSubtree("root");
    expect(board.getNode("root")).toBeUndefined();
    expect(board.getNode("child")).toBeUndefined();
  });
});

describe("topologicalSort", () => {
  it("linear chain a->b->c", () => {
    const layers = topologicalSort([tn("a"), tn("b", { parentId: "a" }), tn("c", { parentId: "b" })]);
    expect(layers.length).toBe(3);
    expect(layers[0]).toContain("a");
  });

  it("independent roots same layer", () => {
    const layers = topologicalSort([tn("x"), tn("y")]);
    expect(layers.length).toBe(1);
    expect(layers[0].length).toBe(2);
  });

  it("detect cycle returns empty", () => {
    expect(topologicalSort([tn("a", { parentId: "b" }), tn("b", { parentId: "a" })]).length).toBe(0);
  });

  it("empty input returns empty", () => {
    expect(topologicalSort([]).length).toBe(0);
  });
});

describe("AgentPool", () => {
  let pool: AgentPool;
  beforeEach(() => { pool = new AgentPool(); });

  it("register + spawn + quota", () => {
    pool.register({ type: AT.Code, maxInstances: 2 });
    expect(pool.spawn(AT.Code, "c1")).toBe(true);
    expect(pool.spawn(AT.Code, "c2")).toBe(true);
    expect(pool.spawn(AT.Code, "c3")).toBe(false);
    pool.destroy(AT.Code, "c1");
    expect(pool.spawn(AT.Code, "c3")).toBe(true);
  });

  it("spawn unregistered returns false", () => {
    expect(pool.spawn(AT.Review, "r1")).toBe(false);
  });
});

describe("PipelineObserver", () => {
  it("on + emit + off lifecycle", () => {
    const obs = new PipelineObserver();
    const received: unknown[] = [];
    const handler = (e: unknown) => received.push(e);
    obs.on(PipelinePriority.NORMAL, handler);
    obs.emit({ type: PipelineEventType.NodeStart, priority: PipelinePriority.NORMAL, payload: { nodeId: "n1", type: "t" }, timestamp: Date.now() });
    expect(received.length).toBe(1);
    obs.off(PipelinePriority.NORMAL, handler);
    obs.emit({ type: PipelineEventType.NodeStart, priority: PipelinePriority.NORMAL, payload: { nodeId: "n2", type: "t" }, timestamp: Date.now() });
    expect(received.length).toBe(1);
  });
});

describe("Three Abstractions", () => {
  it("TagMatchingStrategy + TopologicalLayeredDriver + PipelineModel + FixedModelRouter", () => {
    expect(new TagMatchingStrategy()).toBeDefined();
    expect(new TopologicalLayeredDriver()).toBeDefined();
    expect(new PipelineModel()).toBeDefined();
    expect(new FixedModelRouter()).toBeDefined();
  });
});

describe("E2E Pipeline", () => {
  it("TaskBoard -> topoSort -> claim -> complete full flow", () => {
    const board = new TaskBoard();
    const pool = new AgentPool();
    pool.register({ type: AT.Code, maxInstances: 3 });

    board.addNode(tn("root"));
    board.addNode(tn("c1", { parentId: "root", type: "test" }));
    board.addNode(tn("c2", { parentId: "root", type: "review" }));

    const layers = topologicalSort(board.getPendingNodes());
    expect(layers.length).toBeGreaterThan(0);

    for (const layer of layers) {
      for (const nodeId of layer) {
        board.claim(nodeId, AT.Code);
        board.complete(nodeId, AT.Code, true, `done-${nodeId}`);
      }
    }

    for (const id of ["root", "c1", "c2"]) {
      const n = board.getNode(id);
      expect(n?.status === "done").toBe(true);
    }
  });
});
