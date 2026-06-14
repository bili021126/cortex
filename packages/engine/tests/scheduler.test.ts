// @ci: unit
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentType, PipelinePriority } from "@cortex/shared";
import { TaskBoard, AgentPool, PipelineObserver, ConfirmGate, createAgent, codeAgentConfig, reviewAgentConfig, analysisAgentConfig, Scheduler, topologicalSort, ManifoldGate } from "@cortex/engine";
import { Toolkit } from "@cortex/platform";
import { MemoryStore } from "@cortex/memory-store";
import { LlmAdapter } from "@cortex/llm";

// ─── Mock Agent ────────────────────────────

async function mockAgentByType(agentType: string, success = true, output = `done by ${agentType}`) {
  const adapter = new LlmAdapter({
    apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock"});
  adapter.injectMock(async () => ({ content: output, toolCalls: [] }));
  const tk = new Toolkit();
  let agent;
  switch (agentType) {
    case AgentType.Code: agent = createAgent(codeAgentConfig("test"), adapter, tk); break;
    case AgentType.Review: agent = createAgent(reviewAgentConfig("test"), adapter, tk); break;
    case AgentType.Analysis: agent = createAgent(analysisAgentConfig("test"), adapter, tk); break;
    default: agent = createAgent(codeAgentConfig("test"), adapter, tk);
  }
  await agent.wakeup();
  return agent;
}

// ─── 拓扑排序 ─────────────────────────────────────

describe("topologicalSort", () => {
  it("无依赖节点全部在第 0 层", () => {
    const nodes = [
      { id: "a", tags: ["implementation"], payload: "A", type: "impl", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
      { id: "b", tags: ["implementation"], payload: "B", type: "impl", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
    ];
    const layers = topologicalSort(nodes as any);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toEqual(["a", "b"]);
  });

  it("子节点在父节点之后", () => {
    const nodes = [
      { id: "a", parentId: undefined, tags: ["implementation"], payload: "A", type: "impl", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
      { id: "b", parentId: "a", tags: ["implementation"], payload: "B", type: "impl", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
      { id: "c", parentId: "a", tags: ["implementation"], payload: "C", type: "impl", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
    ];
    const layers = topologicalSort(nodes as any);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toEqual(["a"]);
    expect(layers[1]).toContain("b");
    expect(layers[1]).toContain("c");
  });

  it("三层嵌套", () => {
    const nodes = [
      { id: "r", parentId: undefined, tags: ["implementation"], payload: "Root", type: "impl", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
      { id: "m", parentId: "r", tags: ["implementation"], payload: "Mid", type: "impl", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
      { id: "l", parentId: "m", tags: ["implementation"], payload: "Leaf", type: "impl", status: "pending" as const, needsMultiPerspective: false, claimedBy: [], results: [], createdAt: 0 },
    ];
    const layers = topologicalSort(nodes as any);
    expect(layers).toHaveLength(3);
    expect(layers[0]).toEqual(["r"]);
    expect(layers[1]).toEqual(["m"]);
    expect(layers[2]).toEqual(["l"]);
  });
});

// ─── Scheduler ────────────────────────────────────

describe("Scheduler", () => {
  let board: TaskBoard;
  let pool: AgentPool;
  let observer: PipelineObserver;
  let gate: ConfirmGate;
  let scheduler: Scheduler;

  beforeEach(async () => {
    ManifoldGate.reset();
    board = new TaskBoard();
    pool = new AgentPool();
    observer = new PipelineObserver();
    gate = new ConfirmGate();

    // 注册 Agent 配置
    pool.register({ type: AgentType.Code, maxInstances: 3 });
    pool.register({ type: AgentType.Review, maxInstances: 3 });
    pool.register({ type: AgentType.Analysis, maxInstances: 3 });

    scheduler = new Scheduler(board, pool, observer);

    // 注册 agents
    scheduler.register(AgentType.Code, await mockAgentByType(AgentType.Code), "mock");
    scheduler.register(AgentType.Review, await mockAgentByType(AgentType.Review), "mock");
    scheduler.register(AgentType.Analysis, await mockAgentByType(AgentType.Analysis), "mock");
  });

  afterEach(() => {
    ManifoldGate.reset();
  });

  it("单节点单 Agent 执行成功", async () => {
    board.addNode({
      id: "n1",
      type: "implementation",
      tags: ["implementation"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "修一个 bug",
      results: [],
      createdAt: Date.now()});

    const report = await scheduler.executeAll();

    expect(report.totalNodes).toBe(1);
    expect(report.completed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.results[0].success).toBe(true);
    expect(report.results[0].output).toContain("done by code");

    // TaskBoard 状态已更新
    const node = board.getNode("n1")!;
    expect(node.status).toBe("done");
  });

  it("父子节点按依赖顺序执行", async () => {
    board.addNode({
      id: "parent",
      type: "implementation",
      tags: ["implementation"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "父任务",
      results: [],
      createdAt: Date.now()});
    board.addNode({
      id: "child",
      parentId: "parent",
      type: "implementation",
      tags: ["implementation"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "子任务",
      results: [],
      createdAt: Date.now()});

    const events: string[] = [];
    observer.on(PipelinePriority.HIGH, (e: any) => {
      if (e.type === "node.complete") events.push(e.payload.nodeId);
    });

    const report = await scheduler.executeAll();

    expect(report.totalNodes).toBe(2);
    expect(report.completed).toBe(2);
    // 父先完成
    expect(events).toEqual(["parent", "child"]);
  });

  it("无匹配 Agent 的节点标记失败", async () => {
    board.addNode({
      id: "orphan",
      type: "deploy",
      tags: ["deploy"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "部署任务",
      results: [],
      createdAt: Date.now()});

    const report = await scheduler.executeAll();

    expect(report.totalNodes).toBe(1);
    expect(report.completed).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.results[0].error).toContain("No agent matches");
  });

  it("多视角节点并行执行所有匹配 Agent", { timeout: 15000 }, async () => {
    board.addNode({
      id: "multi-1",
      type: "review",
      tags: ["review", "audit", "analysis"],
      needsMultiPerspective: true,
      status: "pending",
      claimedBy: [],
      payload: "安全审查 + 架构审计",
      results: [],
      createdAt: Date.now()});

    const report = await scheduler.executeAll();

    expect(report.totalNodes).toBe(1);
    expect(report.completed).toBe(1);

    // TaskBoard 的多视角等齐——匹配的 Agent 都跑（Review 匹配 review/audit，Analysis 匹配 analysis）
    const node = board.getNode("multi-1")!;
    expect(node.status).toBe("done");
    expect(node.results).toHaveLength(2);
    const agentTypes = node.results.map((r) => r.agentType);
    expect(agentTypes).toContain(AgentType.Review);
    expect(agentTypes).toContain(AgentType.Analysis);
  });

  it("调度层事件被正确发布", async () => {
    const events: string[] = [];
    const push = (e: any) => events.push(e.type);
    observer.on(PipelinePriority.HIGH, push);
    observer.on(PipelinePriority.CRITICAL, push);

    board.addNode({
      id: "e1",
      type: "implementation",
      tags: ["implementation"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "事件测试",
      results: [],
      createdAt: Date.now()});

    await scheduler.executeAll();

    // 层开始 + node.start + node.complete + scheduler.done
    expect(events).toContain("scheduler.layer.start");
    expect(events).toContain("node.start");
    expect(events).toContain("node.complete");
    expect(events).toContain("scheduler.done");
  });

  it("集成 MemoryStore：执行后自动写入 EPISODIC 记忆", async () => {
    const memory = new MemoryStore(undefined, undefined, {
      embedText: async () => new Array(384).fill(0.1),
      embedBatch: async (texts: string[]) => texts.map(() => new Array(384).fill(0.1)),
    });
    await memory.init(":memory:");
    const adapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock"});
    adapter.injectMock(async () => ({ content: "产出内容", toolCalls: [] }));
    // CodeAgent 注入 MemoryStore 以写记忆
    const agentWithMem = createAgent(codeAgentConfig("test"), adapter, new Toolkit(), memory);

    const memScheduler = new Scheduler(board, pool, observer);
    await agentWithMem.wakeup();
    memScheduler.register(AgentType.Code, agentWithMem, "mock");

    board.addNode({
      id: "mem-node",
      type: "implementation",
      tags: ["implementation"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "写记忆测试",
      results: [],
      createdAt: Date.now()});

    await memScheduler.executeAll();

    const mems = await memory.read({ kind: "TaskLog" });
    expect(mems.length).toBeGreaterThanOrEqual(1);
    expect(mems[0].summary).toContain("写记忆测试");
    expect(mems[0].source.agentType).toBe(AgentType.Code);
  });
});
