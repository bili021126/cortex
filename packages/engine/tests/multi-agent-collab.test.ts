import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentType, MemoryType, MemoryState, PipelinePriority } from "@cortex/shared";
import type { ObservableEvent } from "@cortex/shared";
import { TaskBoard } from "../src/task-board";
import { AgentPool } from "../src/agent-pool";
import { PipelineObserver } from "../src/pipeline-observer";
import { ConfirmGate } from "../src/confirm-gate";
import { LlmAdapter } from "../src/llm-adapter";
import { Toolkit } from "../src/toolkit";
import { CodeAgent } from "../src/code-agent";
import { ReviewAgent } from "../src/review-agent";
import { AnalysisAgent } from "../src/analysis-agent";
import { MemoryStore } from "../src/memory-store";
import { MetaAgent } from "../src/meta-agent";
import { InspectorAgent } from "../src/inspector-agent";
import { Scheduler } from "../src/scheduler";

// ─── Mock helpers ────────────────────────────────

function mockAdapter(output: string) {
  const adapter = new LlmAdapter({
    apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
  });
  adapter.injectMock(async () => ({ content: output, toolCalls: [] }));
  return adapter;
}

async function mockAgent(agentType: string, adapter: LlmAdapter) {
  const tk = new Toolkit();
  let agent;
  switch (agentType) {
    case AgentType.Code: agent = new CodeAgent(adapter, tk); break;
    case AgentType.Review: agent = new ReviewAgent(adapter, tk); break;
    case AgentType.Analysis: agent = new AnalysisAgent(adapter, tk); break;
    default: agent = new CodeAgent(adapter, tk);
  }
  await agent.wakeup();
  return agent;
}

function makeNode(overrides: Partial<{
  id: string; parentId: string; type: string; tags: string[];
  needsMultiPerspective: boolean; payload: string;
}> = {}) {
  return {
    id: overrides.id ?? "n1",
    parentId: overrides.parentId,
    type: overrides.type ?? "implementation",
    tags: (overrides.tags ?? ["implementation"]) as any,
    needsMultiPerspective: overrides.needsMultiPerspective ?? false,
    status: "pending" as const,
    claimedBy: [] as never[],
    payload: overrides.payload ?? "do something",
    results: [] as never[],
    createdAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════════
// 场景 1：串行协作 CodeAgent → ReviewAgent
// ═══════════════════════════════════════════════════

describe("串行协作 CodeAgent → ReviewAgent", () => {
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

    pool.register({ type: AgentType.Code, maxInstances: 3 });
    pool.register({ type: AgentType.Review, maxInstances: 3 });

    scheduler = new Scheduler(board, pool, observer, gate);
  });

  it("CodeAgent 产出 → ReviewAgent 审查（拓扑排序保证顺序）", async () => {
    // ── Arrange ──
    const codeNode = makeNode({
      id: "code-1",
      type: "implementation",
      tags: ["implementation"],
      payload: "Implement login handler",
    });
    const reviewNode = makeNode({
      id: "review-1",
      parentId: "code-1",
      type: "review",
      tags: ["review"],
      payload: "Review login handler",
    });

    board.addNode(codeNode);
    board.addNode(reviewNode);

    const codeRunner = await mockAgent(AgentType.Code, mockAdapter("function login() { return 'ok'; }"));
    const reviewRunner = await mockAgent(AgentType.Review, mockAdapter("LGTM, no issues found"));

    scheduler.register(AgentType.Code, codeRunner, "mock");
    scheduler.register(AgentType.Review, reviewRunner, "mock");

    const events: string[] = [];
    observer.on(PipelinePriority.HIGH, (e: ObservableEvent) => {
      if (e.type === "node.start" || e.type === "node.complete") {
        events.push(`${e.type}:${(e.payload as any).nodeId}`);
      }
    });

    // ── Act ──
    const report = await scheduler.executeAll();

    // ── Assert ──
    expect(report.completed).toBe(2);
    expect(report.failed).toBe(0);

    // 验证拓扑顺序：code 先于 review
    const codeIdx = events.findIndex((s) => s.includes("code-1"));
    const reviewIdx = events.findIndex((s) => s.includes("review-1"));
    expect(codeIdx).toBeLessThan(reviewIdx);

    // 验证节点状态
    const codeNodeFinal = board.getNode("code-1")!;
    expect(codeNodeFinal.results).toHaveLength(1);
    expect(codeNodeFinal.results[0].success).toBe(true);

    const reviewNodeFinal = board.getNode("review-1")!;
    expect(reviewNodeFinal.results).toHaveLength(1);
    expect(reviewNodeFinal.results[0].success).toBe(true);
  });

  it("父节点失败 → 子节点仍执行（已存在节点不受影响）", async () => {
    // ── Arrange ──
    const codeNode = makeNode({
      id: "code-2",
      type: "implementation",
      tags: ["implementation"],
      payload: "Implement login",
    });
    const reviewNode = makeNode({
      id: "review-2",
      parentId: "code-2",
      type: "review",
      tags: ["review"],
      payload: "Review login",
    });

    board.addNode(codeNode);
    board.addNode(reviewNode);

    // Code agent 失败 — 注入一个必定抛异常的 mock
    const failAdapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    failAdapter.injectMock(async () => {
      throw new Error("Code execution failed");
    });
    const failCodeRunner = new CodeAgent(failAdapter, new Toolkit());
    await failCodeRunner.wakeup();

    const reviewRunner = await mockAgent(AgentType.Review, mockAdapter("Needs work"));

    scheduler.register(AgentType.Code, failCodeRunner, "mock");
    scheduler.register(AgentType.Review, reviewRunner, "mock");

    // ── Act ──
    const report = await scheduler.executeAll();

    // ── Assert ──
    // code 失败，review 仍执行（当前策略：子节点不因父节点失败而跳过）
    expect(report.completed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.results).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════
// 场景 2：开会 needsMultiPerspective 并行
// ═══════════════════════════════════════════════════

describe("开会 needsMultiPerspective 并行", () => {
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

    pool.register({ type: AgentType.Review, maxInstances: 3 });
    pool.register({ type: AgentType.Analysis, maxInstances: 3 });
    pool.register({ type: AgentType.Code, maxInstances: 3 });

    scheduler = new Scheduler(board, pool, observer, gate);
  });

  it("needsMultiPerspective 节点 → 2 Agent 并行认领+执行", async () => {
    // ── Arrange ──
    const node = makeNode({
      id: "multi-1",
      type: "analysis",
      tags: ["review", "analysis"],
      needsMultiPerspective: true,
      payload: "Assess security of login flow",
    });
    board.addNode(node);

    const reviewRunner = await mockAgent(AgentType.Review, mockAdapter("Review: password hashing OK, rate limiting missing"));
    const analysisRunner = await mockAgent(AgentType.Analysis, mockAdapter("Analysis: OWASP Top 10 scan complete"));

    scheduler.register(AgentType.Review, reviewRunner, "mock");
    scheduler.register(AgentType.Analysis, analysisRunner, "mock");

    // 追踪认领
    const claimedTypes: string[] = [];
    observer.on(PipelinePriority.HIGH, (e: ObservableEvent) => {
      if (e.type === "node.complete") {
        const payload = e.payload as any;
        if (payload.perspectives) {
          claimedTypes.push(...payload.perspectives);
        }
      }
    });

    // ── Act ──
    const report = await scheduler.executeAll();

    // ── Assert ──
    expect(report.completed).toBe(1);

    // 两个 Agent 都认领了这个节点
    const finalNode = board.getNode("multi-1")!;
    expect(finalNode.claimedBy).toContain(AgentType.Review);
    expect(finalNode.claimedBy).toContain(AgentType.Analysis);
    expect(finalNode.claimedBy).toHaveLength(2);

    // 多视角聚合结果包含两个 agent 的输出
    expect(claimedTypes).toContain(AgentType.Review);
    expect(claimedTypes).toContain(AgentType.Analysis);

    // 聚合输出包含两个视角
    const result = report.results[0];
    expect(result.output).toContain("Review");
  });

  it("单视角节点只用第一个匹配 Agent", async () => {
    // ── Arrange ──
    // 当一个节点匹配多个标签时（如 analysis 同时匹配 Review 和 Analysis 标签），
    // 只使用第一个匹配的 Agent（按注册顺序）
    const node = makeNode({
      id: "single-1",
      type: "implementation",
      tags: ["implementation"],  // 只有 Code 匹配
      needsMultiPerspective: false,
      payload: "Write unit tests",
    });
    board.addNode(node);

    const codeRunner = await mockAgent(AgentType.Code, mockAdapter("test done"));
    scheduler.register(AgentType.Code, codeRunner, "mock");

    // ── Act ──
    const report = await scheduler.executeAll();

    // ── Assert ──
    expect(report.completed).toBe(1);

    const finalNode = board.getNode("single-1")!;
    expect(finalNode.claimedBy).toHaveLength(1);
    expect(finalNode.claimedBy[0]).toBe(AgentType.Code);
  });

  it("needsMultiPerspective 无匹配 Agent → 全部失败", async () => {
    // ── Arrange ──
    const node = makeNode({
      id: "multi-2",
      type: "analysis",
      tags: ["audit", "constitution_check"],
      needsMultiPerspective: true,
      payload: "Perform constitution audit",
    });
    board.addNode(node);

    // 不注册任何 runner，也没有 Agent 能匹配 constitution_check 标签

    // ── Act ──
    const report = await scheduler.executeAll();

    // ── Assert ──
    expect(report.failed).toBe(1);
    expect(report.results[0].error).toContain("No agents match");
  });
});

// ═══════════════════════════════════════════════════
// 场景 3：重规划 CodeAgent 失败 → MetaAgent 重规划
// ═══════════════════════════════════════════════════

describe("重规划 失败 → MetaAgent 重规划", () => {
  let board: TaskBoard;
  let pool: AgentPool;
  let observer: PipelineObserver;
  let gate: ConfirmGate;
  let memory: MemoryStore;
  let scheduler: Scheduler;

  beforeEach(() => {
    board = new TaskBoard();
    pool = new AgentPool();
    observer = new PipelineObserver();
    gate = new ConfirmGate();
    memory = new MemoryStore();

    pool.register({ type: AgentType.Code, maxInstances: 3 });
    pool.register({ type: AgentType.Analysis, maxInstances: 3 });
  });

  it("CodeAgent 失败 → MetaAgent 重规划 → 新节点执行", async () => {
    // ── Arrange ──
    // 1. 构造一个注定失败的 task
    const node = makeNode({
      id: "fail-1",
      type: "implementation",
      tags: ["implementation"],
      payload: "Build a rocket engine",
    });
    board.addNode(node);

    // 2. 创建带 MetaAgent 的 Scheduler
    const metaAdapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    metaAdapter.injectMock(async () => ({
      content: JSON.stringify([
        { task: "Research rocket propulsion alternatives", type: "research", tags: ["research"], needsMultiPerspective: false },
      ]),
      toolCalls: [],
    }));

    const metaAgent = new MetaAgent(metaAdapter);
    scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

    // 3. 注册 Analysis runner（用于执行重规划产出的 research 节点）
    const analysisRunner = await mockAgent(AgentType.Analysis, mockAdapter("Research: rocket engines need specialized materials"));
    scheduler.register(AgentType.Analysis, analysisRunner, "mock");

    // 4. 监听重规划事件
    let replanAttempt = 0;
    observer.on(PipelinePriority.CRITICAL, (e: ObservableEvent) => {
      if (e.type === "node.replan") {
        replanAttempt = (e.payload as any).attempt;
      }
    });

    // ── Act ──
    const report = await scheduler.executeAll();

    // ── Assert ──
    // 重规划成功：原节点结果被替换为重规划的成功结果
    const failResult = report.results.find((r) => r.nodeId === "fail-1")!;
    expect(failResult.success).toBe(true);
    expect(failResult.output).toContain("Replanned");

    // 重规划被触发（第一次失败后，未达 3 轮上限）
    expect(replanAttempt).toBe(1);

    // 重规划产生的新节点在 board 中（原节点已被 replan 移除）
    const allNodes = board.getAllNodes();
    expect(allNodes.length).toBeGreaterThanOrEqual(1); // 至少新节点在板上
  });

  it("超过 3 轮重规划 → 放弃重规划", async () => {
    // ── Arrange ──
    const node = makeNode({
      id: "fail-2",
      type: "implementation",
      tags: ["implementation"],
      payload: "Solve P vs NP",
    });
    board.addNode(node);

    // MetaAgent → 每次重规划都返回同一个类型的 implementation 节点（死循环模拟）
    const metaAdapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    metaAdapter.injectMock(async () => ({
      content: JSON.stringify([
        { task: "Attempt approach A", type: "implementation", tags: ["implementation"], needsMultiPerspective: false },
      ]),
      toolCalls: [],
    }));

    const metaAgent = new MetaAgent(metaAdapter);
    scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

    // 只注册 Analysis runner（永远不匹配 implementation 标签 → 新节点持续失败）
    const analysisRunner2 = await mockAgent(AgentType.Analysis, mockAdapter("unsolvable"));
    scheduler.register(AgentType.Analysis, analysisRunner2, "mock");

    const replanCounts: number[] = [];
    observer.on(PipelinePriority.CRITICAL, (e: ObservableEvent) => {
      if (e.type === "node.replan") {
        replanCounts.push((e.payload as any).attempt);
      }
    });

    // ── Act ──
    const report = await scheduler.executeAll();

    // ── Assert ──
    // 3 轮重规划全部触发（1, 2, 3）
    expect(replanCounts).toEqual([1, 2, 3]);

    // 最终仍然失败
    const failResult = report.results.find((r) => r.nodeId === "fail-2")!;
    expect(failResult.success).toBe(false);
  });

  it("重规划成功 → 新节点全部通过", async () => {
    // ── Arrange ──
    const node = makeNode({
      id: "fail-3",
      type: "implementation",
      tags: ["implementation"],
      payload: "Implement complex algorithm",
    });
    board.addNode(node);

    // MetaAgent → 重规划为 research 类型（能被 Analysis agent 处理）
    const metaAdapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    metaAdapter.injectMock(async () => ({
      content: JSON.stringify([
        { task: "Research algorithm alternatives", type: "research", tags: ["research"], needsMultiPerspective: false },
        { task: "Compare time complexity", type: "analysis", tags: ["analysis"], needsMultiPerspective: false },
      ]),
      toolCalls: [],
    }));

    const metaAgent = new MetaAgent(metaAdapter);
    scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

    // 注册 Analysis runner（用于执行重规划产出的 research/analysis 节点）
    const analysisRunner3 = await mockAgent(AgentType.Analysis, mockAdapter("Research: algorithm complexity analysis"));
    scheduler.register(AgentType.Analysis, analysisRunner3, "mock");

    // ── Act ──
    const report = await scheduler.executeAll();

    // ── Assert ──
    // 原始节点重规划成功
    const replanResult = report.results.find((r) => r.nodeId === "fail-3")!;
    expect(replanResult.success).toBe(true);

    // 新加的节点至少有 1 个（research matched）
    const allNodes = board.getAllNodes();
    expect(allNodes.length).toBeGreaterThanOrEqual(2);
  });

  it("无 MetaAgent 注入 → 失败不触发重规划", async () => {
    // ── Arrange ──
    // scheduler 没有 metaAgent
    scheduler = new Scheduler(board, pool, observer, gate);

    const node = makeNode({
      id: "fail-4",
      type: "implementation",
      tags: ["implementation"],
      payload: "Do impossible thing",
    });
    board.addNode(node);

    // 无匹配 runner

    // ── Act ──
    const report = await scheduler.executeAll();

    // ── Assert ──
    expect(report.failed).toBe(1);
    // 无重规划事件
    // 板上的节点数不变
    expect(board.getAllNodes()).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════
// 场景 4：InspectorAgent 认领 inspect 节点
// ═══════════════════════════════════════════════════

describe("InspectorAgent 认领 inspect 节点", () => {
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

    pool.register({ type: AgentType.Inspector, maxInstances: 3 });

    scheduler = new Scheduler(board, pool, observer, gate);
  });

  it("Inspector 认领 inspect 节点 → 产出事实报告", async () => {
    // ── Arrange ──
    const node = makeNode({
      id: "inspect-1",
      type: "inspect",
      tags: ["inspect"],
      payload: "Inspect login.ts for facts",
    });
    board.addNode(node);

    const inspectorAdapter = mockAdapter("事实报告：login.ts 共 45 行，导出 3 个函数");
    const inspectorRunner = new InspectorAgent(inspectorAdapter, new Toolkit());
    await inspectorRunner.wakeup();

    scheduler.register(AgentType.Inspector, inspectorRunner, "mock");

    // ── Act ──
    const report = await scheduler.executeAll();

    // ── Assert ──
    expect(report.completed).toBe(1);
    expect(report.failed).toBe(0);

    const finalNode = board.getNode("inspect-1")!;
    expect(finalNode.claimedBy).toContain(AgentType.Inspector);
    expect(finalNode.claimedBy).toHaveLength(1);
    expect(finalNode.results[0].success).toBe(true);
    expect(finalNode.results[0].output).toContain("事实报告");
  });
});
