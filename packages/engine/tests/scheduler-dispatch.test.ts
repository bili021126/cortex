import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentType, AgentStatus, type TaskNode, type NodeResult } from "@cortex/shared";
import type { Agent } from "@cortex/shared";
import { Scheduler } from "../src/scheduler.js";
import { TaskBoard } from "../src/task-board.js";
import { AgentPool } from "../src/agent-pool.js";
import { PipelineObserver } from "../src/pipeline-observer.js";
import { ConfirmGate } from "../src/confirm-gate.js";

function makeNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "node-1",
    type: "code",
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

function makeMockAgent(status: AgentStatus = AgentStatus.Awake): Agent {
  return {
    type: AgentType.Code,
    status,
    wakeup: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue({ nodeId: "node-1", success: true, output: "ok" } as NodeResult),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Scheduler._dispatchNode", () => {
  let board: TaskBoard;
  let pool: AgentPool;
  let observer: PipelineObserver;
  let gate: ConfirmGate;
  let scheduler: Scheduler;

  beforeEach(() => {
    board = new TaskBoard();
    pool = new AgentPool();
    observer = new PipelineObserver();
    gate = new ConfirmGate();
    gate.bypassAll();
    scheduler = new Scheduler(board, pool, observer, gate);
    // 注册 pool 配置，否则 spawn 失败
    pool.register({ type: AgentType.Code, maxInstances: 3 });
  });

  it("handles empty board with zero results", async () => {
    const report = await scheduler.executeAll();
    expect(report.totalNodes).toBe(0);
    expect(report.completed).toBe(0);
    expect(report.failed).toBe(0);
  });

  it("dispatches pending node to success via executeAll", async () => {
    const node = makeNode({ id: "test-1", type: "code" });
    board.addNode(node);

    const agent = makeMockAgent();
    scheduler.register("code", agent, "test-model");

    const report = await scheduler.executeAll();
    expect(report.completed).toBeGreaterThanOrEqual(1);
    expect(agent.execute).toHaveBeenCalled();
  });

  it("marks node as failed when agent execution throws", async () => {
    const node = makeNode({ id: "fail-1", type: "code" });
    board.addNode(node);

    const agent = makeMockAgent();
    agent.execute = vi.fn().mockRejectedValue(new Error("simulated failure"));
    scheduler.register("code", agent, "test-model");

    const report = await scheduler.executeAll();
    const failResult = report.results.find((r) => r.nodeId === "fail-1");
    expect(failResult).toBeDefined();
    expect(failResult!.success).toBe(false);
  });

  it("routes single-perspective node through _dispatchSingle path", async () => {
    const singleNode = makeNode({ id: "single-1", type: "code", needsMultiPerspective: false });
    board.addNode(singleNode);

    const agent = makeMockAgent();
    agent.execute = vi.fn().mockResolvedValue({ nodeId: "single-1", success: true, output: "single ok" });
    scheduler.register("code", agent, "test-model");

    const report = await scheduler.executeAll();
    const r = report.results.find((r) => r.nodeId === "single-1");
    expect(r).toBeDefined();
    expect(r!.success).toBe(true);
  });
});
