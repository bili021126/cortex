// @ci: unit
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentType, AgentStatus, type TaskNode, type NodeResult, PipelinePriority, PipelineEventType } from "@cortex/shared";
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

  // ── P2-5 回归：Scheduler node.failed 去重 ──
  it("P0-1 regression: NodeFailed event fires exactly once per failure (singleton dedup)", async () => {
    const failNode = makeNode({ id: "dedup-fail-1", type: "code" });
    board.addNode(failNode);

    const agent = makeMockAgent();
    agent.execute = vi.fn().mockRejectedValue(new Error("simulated failure"));
    scheduler.register("code", agent, "test-model");

    const failedEvents: Array<{ type: string; nodeId: string }> = [];
    observer.on(PipelinePriority.CRITICAL, (e) => {
      if (e.type === PipelineEventType.NodeFailed) {
        failedEvents.push({ type: e.type, nodeId: (e.payload as Record<string, unknown>).nodeId as string });
      }
    });

    await scheduler.executeAll();

    // 关键断言：node.failed 事件只发射一次，不多发不遗漏
    const dedupEvents = failedEvents.filter((e) => e.nodeId === "dedup-fail-1");
    expect(dedupEvents).toHaveLength(1);
  });
});

describe("Scheduler._findMatchingAgent 密度平局打破", () => {
  let board: TaskBoard;
  let pool: AgentPool;
  let observer: PipelineObserver;
  let gate: ConfirmGate;
  let scheduler: Scheduler;

  function makeReviewAgent(): Agent {
    return {
      type: AgentType.Review,
      status: AgentStatus.Awake,
      wakeup: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue({ nodeId: "", success: true, output: "reviewed" } as NodeResult),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
  }

  function makeCodeAgent(): Agent {
    return {
      type: AgentType.Code,
      status: AgentStatus.Awake,
      wakeup: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue({ nodeId: "", success: true, output: "coded" } as NodeResult),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
  }

  beforeEach(() => {
    board = new TaskBoard();
    pool = new AgentPool();
    observer = new PipelineObserver();
    gate = new ConfirmGate();
    gate.bypassAll();
    scheduler = new Scheduler(board, pool, observer, gate);
    pool.register({ type: AgentType.Review, maxInstances: 3 });
    pool.register({ type: AgentType.Code, maxInstances: 3 });
  });

  // ── P2-5 回归：密度平局打破 ──
  it("P0-3 regression: Review wins over Code for tags=[\"review\"] via match density", async () => {
    // Code 的 AGENT_TAGS 含 "review"（8 标签中 1 个），Review 含 "review"（2 标签中 1 个）
    // 两者评分=1 平局，Review 密度 1/2=0.5 > Code 密度 1/8=0.125
    const node: TaskNode = {
      id: "review-node",
      type: "implementation",
      tags: ["review"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "review task",
      results: [],
      createdAt: Date.now(),
    };
    board.addNode(node);

    const reviewAgent = makeReviewAgent();
    const codeAgent = makeCodeAgent();
    scheduler.register(AgentType.Review, reviewAgent, "test-model");
    scheduler.register(AgentType.Code, codeAgent, "test-model");

    await scheduler.executeAll();

    // 密度打破：Review execute 被调用，Code 不应被调用
    expect(reviewAgent.execute).toHaveBeenCalled();
    expect(codeAgent.execute).not.toHaveBeenCalled();
  });
});
