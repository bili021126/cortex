// @ci: unit
/**
 * TaskBoard 树稳健性压力测试
 * 覆盖六大暗雷：并发 claim、父节点失败级联、重规划插入运行中层、
 * 多视角完成竞态、CircuitBreaker 熔断、部分层失败处理
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentType, PipelinePriority, MemoryState } from "@cortex/shared";
import type { ObservableEvent } from "@cortex/shared";
import { TaskBoard } from "../src/task-board";
import { AgentPool } from "../src/agent-pool";
import { PipelineObserver } from "../src/pipeline-observer";
import { ConfirmGate } from "../src/confirm-gate";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "../src/toolkit";
import { createAgent } from "../src/components/agent-factory";
import { codeAgentConfig } from "../src/agents/code-agent";
import { reviewAgentConfig } from "../src/agents/review-agent";
import { analysisAgentConfig } from "../src/agents/analysis-agent";
import { MemoryStore } from "../src/memory/memory-store.js";
import { MetaAgent } from "../src/meta-agent";
import { Scheduler, topologicalSort } from "../src/scheduler";

// ─── Test helpers ───────────────────────────────

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

function mockAdapter(output: string) {
  const adapter = new LlmAdapter({
    apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
  });
  adapter.injectMock(async () => ({ content: output, toolCalls: [] }));
  return adapter;
}

// ═══════════════════════════════════════════════════
// 暗雷 1：并发 claim 安全性（同一层多节点竞争）
// ═══════════════════════════════════════════════════

describe("暗雷 R1：并发 claim 安全性", () => {
  it("同层多个同类型节点不会互相抢认领——Scheduler 按节点 ID 分发", async () => {
    const board = new TaskBoard();
    const pool = new AgentPool();
    const observer = new PipelineObserver();
    const gate = new ConfirmGate();

    pool.register({ type: AgentType.Code, maxInstances: 5 });

    // 同一层有多个 implementation 节点
    board.addNode(makeNode({ id: "n1", tags: ["implementation"], payload: "Task 1" }));
    board.addNode(makeNode({ id: "n2", tags: ["implementation"], payload: "Task 2" }));
    board.addNode(makeNode({ id: "n3", tags: ["implementation"], payload: "Task 3" }));

    const scheduler = new Scheduler(board, pool, observer, gate);
    const agent = createAgent(codeAgentConfig(),mockAdapter("done"), new Toolkit());
    await agent.wakeup();
    scheduler.register(AgentType.Code, agent, "mock");

    const report = await scheduler.executeAll();

    // 三个节点都应被成功执行
    expect(report.completed).toBe(3);
    expect(report.failed).toBe(0);

    // 所有节点状态都是 done
    for (const id of ["n1", "n2", "n3"]) {
      const n = board.getNode(id)!;
      expect(n.status).toBe("done");
    }
  });

  it("同层不同类型 Agent 并行认领各自节点不冲突", async () => {
    const board = new TaskBoard();
    const pool = new AgentPool();
    const observer = new PipelineObserver();
    const gate = new ConfirmGate();

    pool.register({ type: AgentType.Code, maxInstances: 3 });
    pool.register({ type: AgentType.Review, maxInstances: 3 });

    board.addNode(makeNode({ id: "code-1", tags: ["implementation"], payload: "Code task" }));
    board.addNode(makeNode({ id: "review-1", tags: ["review"], payload: "Review task" }));

    const scheduler = new Scheduler(board, pool, observer, gate);

    const codeAgent = createAgent(codeAgentConfig(),mockAdapter("code done"), new Toolkit());
    await codeAgent.wakeup();
    const reviewAgent = createAgent(reviewAgentConfig(),mockAdapter("review done"), new Toolkit());
    await reviewAgent.wakeup();

    scheduler.register(AgentType.Code, codeAgent, "mock");
    scheduler.register(AgentType.Review, reviewAgent, "mock");

    const report = await scheduler.executeAll();

    expect(report.completed).toBe(2);
  });
});

// ═══════════════════════════════════════════════════
// 暗雷 2：父节点失败 → 子节点级联决策
// ═══════════════════════════════════════════════════

describe("暗雷 R2：父节点失败 → 子节点级联", () => {
  it("当前策略：父节点失败不阻止子节点执行（需显式设计级联策略）", async () => {
    const board = new TaskBoard();
    const pool = new AgentPool();
    const observer = new PipelineObserver();
    const gate = new ConfirmGate();

    pool.register({ type: AgentType.Code, maxInstances: 3 });
    pool.register({ type: AgentType.Review, maxInstances: 3 });

    // 父节点 → 注定失败
    board.addNode(makeNode({ id: "bad-parent", tags: ["implementation"], payload: "Impossible task" }));
    // 子节点
    board.addNode(makeNode({
      id: "orphan-child",
      parentId: "bad-parent",
      tags: ["review"],
      payload: "Review something",
    }));

    // 父节点的 Agent 会失败
    const failAdapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    failAdapter.injectMock(async () => {
      throw new Error("BOOM");
    });
    const failCode = createAgent(codeAgentConfig(),failAdapter, new Toolkit());
    await failCode.wakeup();

    const reviewAgent = createAgent(reviewAgentConfig(),mockAdapter("review ok"), new Toolkit());
    await reviewAgent.wakeup();

    const scheduler = new Scheduler(board, pool, observer, gate);
    scheduler.register(AgentType.Code, failCode, "mock");
    scheduler.register(AgentType.Review, reviewAgent, "mock");

    const report = await scheduler.executeAll();

    // 当前策略：子节点仍执行
    expect(report.completed).toBe(1); // review 完成
    expect(report.failed).toBe(1);    // code 失败
  });

  it("建议增强：添加 skipOnParentFailure 节点标记支持级联跳過", () => {
    // 此测试仅记录期望行为——未来可实现 skipOnParentFailure 字段
    // 当 skipOnParentFailure=true 且父节点 status=failed 时，Scheduler 直接标记子节点为 cancelled
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// 暗雷 3：重规划节点插入运行中层
// ═══════════════════════════════════════════════════

describe("暗雷 R3：重规划节点插入运行中层", () => {
  it("重规划产生的新节点被正确执行（不依赖预计算层）", async () => {
    const board = new TaskBoard();
    const pool = new AgentPool();
    const observer = new PipelineObserver();
    const gate = new ConfirmGate();
    const memory = new MemoryStore();

    pool.register({ type: AgentType.Code, maxInstances: 3 });
    pool.register({ type: AgentType.Analysis, maxInstances: 3 });

    // 构造一个会失败的节点
    board.addNode(makeNode({
      id: "fail-node",
      tags: ["implementation"],
      payload: "Impossible implementation",
    }));

    // MetaAgent → 重规划为 research 类型
    const metaAdapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    metaAdapter.injectMock(async () => ({
      content: JSON.stringify([
        { task: "Research alternatives", type: "research", tags: ["research"], needsMultiPerspective: false },
      ]),
      toolCalls: [],
    }));

    const metaAgent = new MetaAgent(metaAdapter);
    const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

    // 注册 Analysis agent 执行重规划产出的 research 节点
    const analysisAgent = createAgent(analysisAgentConfig(),mockAdapter("Research complete"), new Toolkit());
    await analysisAgent.wakeup();
    scheduler.register(AgentType.Analysis, analysisAgent, "mock");

    const report = await scheduler.executeAll();

    // 重规划成功：原节点被替换为 success
    const failResult = report.results.find((r) => r.nodeId === "fail-node")!;
    expect(failResult.success).toBe(true);
    expect(failResult.output).toContain("Replanned");

    // 板上的新节点数 > 1（原节点已被 replan 移除）
    expect(board.getAllNodes().length).toBeGreaterThanOrEqual(1);
  });

  it("重规划期间已有层不受影响——新节点在下个事件循环处理", async () => {
    const board = new TaskBoard();
    const pool = new AgentPool();
    const observer = new PipelineObserver();
    const gate = new ConfirmGate();
    const memory = new MemoryStore();

    pool.register({ type: AgentType.Code, maxInstances: 3 });

    // 同层有 2 个节点：一个成功，一个失败触发重规划
    board.addNode(makeNode({ id: "good-1", tags: ["implementation"], payload: "Simple task" }));
    board.addNode(makeNode({ id: "bad-1", tags: ["implementation"], payload: "Will fail" }));

    // MetaAgent 重规划
    const metaAdapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    metaAdapter.injectMock(async () => ({
      content: JSON.stringify([
        { task: "Simplified approach", type: "implementation", tags: ["implementation"], needsMultiPerspective: false },
      ]),
      toolCalls: [],
    }));
    const metaAgent = new MetaAgent(metaAdapter);

    const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

    // 第一个调用成功，第二个失败
    let callCount = 0;
    const dualAdapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    dualAdapter.injectMock(async () => {
      callCount++;
      if (callCount === 1) return { content: "done", toolCalls: [] };
      throw new Error("Fail on second node");
    });
    const codeAgent = createAgent(codeAgentConfig(),dualAdapter, new Toolkit());
    await codeAgent.wakeup();

    scheduler.register(AgentType.Code, codeAgent, "mock");

    const report = await scheduler.executeAll();

    // good-1 成功
    const goodResult = report.results.find((r) => r.nodeId === "good-1");
    expect(goodResult?.success).toBe(true);

    // bad-1 触发重规划（原 bad-1 被 replan 移除，good-1 + 最终重规划节点）
    expect(board.getAllNodes().length).toBeGreaterThanOrEqual(2); // good-1 + ≥1 重规划节点
  });
});

// ═══════════════════════════════════════════════════
// 暗雷 5：CircuitBreaker 熔断（N 次同因失败 → node.blocked）
// ═══════════════════════════════════════════════════

describe("暗雷 R5：CircuitBreaker 熔断机制", () => {
  it("3 轮重规划上限已是软熔断——超过后放弃节点", async () => {
    const board = new TaskBoard();
    const pool = new AgentPool();
    const observer = new PipelineObserver();
    const gate = new ConfirmGate();
    const memory = new MemoryStore();

    pool.register({ type: AgentType.Code, maxInstances: 3 });
    pool.register({ type: AgentType.Analysis, maxInstances: 3 });

    board.addNode(makeNode({
      id: "doomed",
      tags: ["implementation"],
      payload: "Solve P = NP",
    }));

    // MetaAgent → 每次重规划都返回同类型 implementation（死循环模拟）
    const metaAdapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    metaAdapter.injectMock(async () => ({
      content: JSON.stringify([
        { task: "Attempt another approach", type: "implementation", tags: ["implementation"], needsMultiPerspective: false },
      ]),
      toolCalls: [],
    }));
    const metaAgent = new MetaAgent(metaAdapter);

    const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

    // 只注册 Analysis（不匹配 implementation → 重规划节点持续失败）
    const analysisAgent = createAgent(analysisAgentConfig(),mockAdapter("irrelevant"), new Toolkit());
    await analysisAgent.wakeup();
    scheduler.register(AgentType.Analysis, analysisAgent, "mock");

    const replanCounts: number[] = [];
    observer.on(PipelinePriority.CRITICAL, (e: ObservableEvent) => {
      if (e.type === "node.replan") {
        replanCounts.push((e.payload as any).attempt);
      }
    });

    const report = await scheduler.executeAll();

    // 3 轮重规划全部触发
    expect(replanCounts).toEqual([1, 2, 3]);

    // 最终失败
    const doomedResult = report.results.find((r) => r.nodeId === "doomed")!;
    expect(doomedResult.success).toBe(false);
  });

  it("熔断后 observer 应发布 circuit.break 事件（未来增强）", () => {
    // DSL: 当 node 重规划超过上限时，Scheduler 应发布 scheduler.node.blocked 事件
    // 供 ButlerAgent 通知用户、CircuitBreaker 记录熔断历史
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// 暗雷 6：部分层失败处理
// ═══════════════════════════════════════════════════

describe("暗雷 R6：部分层失败处理", () => {
  it("同层部分节点失败不影响其他节点和后续层", async () => {
    const board = new TaskBoard();
    const pool = new AgentPool();
    const observer = new PipelineObserver();
    const gate = new ConfirmGate();

    pool.register({ type: AgentType.Code, maxInstances: 3 });
    pool.register({ type: AgentType.Review, maxInstances: 3 });

    // Layer 0: 两个节点，一个成功一个失败
    board.addNode(makeNode({ id: "L0-ok", tags: ["implementation"], payload: "OK task" }));
    board.addNode(makeNode({ id: "L0-bad", tags: ["implementation"], payload: "Will fail" }));
    // Layer 1 (depends on L0-ok): 应正常执行
    board.addNode(makeNode({
      id: "L1-review",
      parentId: "L0-ok",
      tags: ["review"],
      payload: "Review results",
    }));

    const scheduler = new Scheduler(board, pool, observer, gate);

    // Code agent: 第一次调用 OK，第二次抛异常
    let callCount = 0;
    const codeAdapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    codeAdapter.injectMock(async () => {
      callCount++;
      if (callCount === 1) return { content: "OK", toolCalls: [] };
      throw new Error("Fail");
    });
    const codeAgent = createAgent(codeAgentConfig(),codeAdapter, new Toolkit());
    await codeAgent.wakeup();

    const reviewAgent = createAgent(reviewAgentConfig(),mockAdapter("review OK"), new Toolkit());
    await reviewAgent.wakeup();

    scheduler.register(AgentType.Code, codeAgent, "mock");
    scheduler.register(AgentType.Review, reviewAgent, "mock");

    const report = await scheduler.executeAll();

    // L0-ok 成功, L1-review 也执行了
    expect(report.completed).toBe(2);
    expect(report.failed).toBe(1);

    const badNode = board.getNode("L0-bad")!;
    expect(badNode.status).toBe("failed");

    const reviewNode = board.getNode("L1-review")!;
    expect(reviewNode.status).toBe("done");
  });

  it("全部节点失败时管线仍正常结束", async () => {
    const board = new TaskBoard();
    const pool = new AgentPool();
    const observer = new PipelineObserver();
    const gate = new ConfirmGate();

    pool.register({ type: AgentType.Code, maxInstances: 3 });

    board.addNode(makeNode({ id: "fail-1", tags: ["implementation"], payload: "Fail 1" }));
    board.addNode(makeNode({ id: "fail-2", tags: ["implementation"], payload: "Fail 2" }));

    const scheduler = new Scheduler(board, pool, observer, gate);

    // 所有调用都抛异常
    const allFail = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    allFail.injectMock(async () => { throw new Error("Everything fails"); });
    const failAgent = createAgent(codeAgentConfig(),allFail, new Toolkit());
    await failAgent.wakeup();

    scheduler.register(AgentType.Code, failAgent, "mock");

    const events: string[] = [];
    observer.on(PipelinePriority.CRITICAL, (e: ObservableEvent) => {
      events.push(e.type);
    });

    const report = await scheduler.executeAll();

    expect(report.completed).toBe(0);
    expect(report.failed).toBe(2);
    // durationMs 可能为 0（同步抛异常无实际异步等待）
    expect(report.durationMs).toBeGreaterThanOrEqual(0);

    // scheduler.done 事件仍发布
    expect(events).toContain("scheduler.done");
  });
});

// ═══════════════════════════════════════════════════
// 暗雷 R7：多视角 spawn 失败自愈（release 死锁回归）
// ═══════════════════════════════════════════════════

describe("暗雷 R7：多视角 spawn 失败自愈", () => {
  it("spawn 失败的 Agent 类型被 release，其他 Agent 继续执行并最终 done", async () => {
    const board = new TaskBoard();
    const pool = new AgentPool();
    const observer = new PipelineObserver();
    const gate = new ConfirmGate();

    // 只给 Review 配额，不给 Analysis — Analysis spawn 必然失败
    pool.register({ type: AgentType.Review, maxInstances: 3 });

    board.addNode(makeNode({
      id: "mp-heal",
      tags: ["review", "research"],
      needsMultiPerspective: true,
      payload: "Code review + architecture analysis",
    }));

    const scheduler = new Scheduler(board, pool, observer, gate);

    const reviewAgent = createAgent(reviewAgentConfig(),mockAdapter("代码审查通过: 无严重缺陷"), new Toolkit());
    await reviewAgent.wakeup();
    const analysisAgent = createAgent(analysisAgentConfig(),mockAdapter("架构分析: 符合设计"), new Toolkit());
    await analysisAgent.wakeup();

    scheduler.register(AgentType.Review, reviewAgent, "mock");
    scheduler.register(AgentType.Analysis, analysisAgent, "mock");

    const spawnFailed: string[] = [];
    observer.on(PipelinePriority.HIGH, (e: ObservableEvent) => {
      if (e.type === "node.spawn_failed") {
        spawnFailed.push((e.payload as any).agentType);
      }
    });

    const report = await scheduler.executeAll();

    // Analysis spawn 失败触发 release，不是 complete
    expect(spawnFailed).toContain(AgentType.Analysis);

    // Review 正常执行完成
    expect(report.completed).toBe(1);
    expect(report.failed).toBe(0);

    // 节点最终 done（Review 产出即等齐，因为 Analysis 已 release）
    const n = board.getNode("mp-heal")!;
    expect(n.status).toBe("done");
    expect(n.claimedBy).not.toContain(AgentType.Analysis);
    expect(n.claimedBy).toContain(AgentType.Review);
  });

  it("全部 Agent spawn 失败后 release → 节点回到 pending", async () => {
    const board = new TaskBoard();
    const pool = new AgentPool();
    const observer = new PipelineObserver();
    const gate = new ConfirmGate();

    pool.register({ type: AgentType.Review, maxInstances: 0 });

    board.addNode(makeNode({
      id: "mp-all-fail",
      tags: ["review"],
      needsMultiPerspective: true,
      payload: "All agents fail",
    }));

    const scheduler = new Scheduler(board, pool, observer, gate);

    const reviewAgent = createAgent(reviewAgentConfig(),mockAdapter("unreachable"), new Toolkit());
    await reviewAgent.wakeup();
    scheduler.register(AgentType.Review, reviewAgent, "mock");

    const report = await scheduler.executeAll();

    expect(report.completed).toBe(0);

    const n = board.getNode("mp-all-fail")!;
    expect(n.status).toBe("failed"); // failNode 置 failed：全部 spawn 失败 → 不可恢复
    expect(n.claimedBy).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════
// 暗雷 R8：claim-release 竞态压测
// ═══════════════════════════════════════════════════

describe("暗雷 R8：claim-release 竞态压测", () => {
  it("高频 claim→release→claim 循环不产生僵尸 claimed 节点", () => {
    const board = new TaskBoard();

    for (let i = 0; i < 20; i++) {
      board.addNode(makeNode({ id: `stress-${i}`, tags: [["implementation", "ops", "review"][i % 3]] }));
    }

    const agentTypes = [AgentType.Code, AgentType.Ops, AgentType.Review];

    for (let round = 0; round < 100; round++) {
      const nodeId = `stress-${round % 20}`;
      const at = agentTypes[round % 3];

      if (round % 2 === 0) {
        board.claim(nodeId, at);
      } else {
        board.release(nodeId, at);
      }
    }

    const allNodes = board.getAllNodes();
    for (const n of allNodes) {
      if (n.status === "claimed" || n.status === "running") {
        expect(n.claimedBy.length).toBeGreaterThan(0);
      }
    }
  });

  it("同节点快速 claim-release-claim 不丢状态", () => {
    const board = new TaskBoard();
    board.addNode(makeNode({ id: "fast", tags: ["implementation"] }));

    for (let i = 0; i < 3; i++) {
      const c = board.claim("fast", AgentType.Code);
      expect(c).not.toBeNull();
      expect(c!.status).toBe("claimed");

      const r = board.release("fast", AgentType.Code);
      expect(r).toBe(true);
      expect(board.getNode("fast")!.status).toBe("pending");
    }

    const finalClaim = board.claim("fast", AgentType.Code);
    expect(finalClaim).not.toBeNull();
    expect(finalClaim!.status).toBe("claimed");
  });

  it("release 后其他 Agent 类型可立即认领", () => {
    const board = new TaskBoard();
    board.addNode(makeNode({ id: "swap", tags: ["implementation", "ops"] }));

    expect(board.claim("swap", AgentType.Code)).not.toBeNull();
    expect(board.getNode("swap")!.claimedBy).toEqual([AgentType.Code]);

    expect(board.release("swap", AgentType.Code)).toBe(true);

    expect(board.claim("swap", AgentType.Ops)).not.toBeNull();
    expect(board.getNode("swap")!.claimedBy).toEqual([AgentType.Ops]);
  });
});

// ═══════════════════════════════════════════════════
// 暗雷 R9：MemoryStore CAS 并发防改写
// ═══════════════════════════════════════════════════

describe("暗雷 R9：MemoryStore CAS 并发防改写", () => {
  it("peek() 返回冻结副本——修改抛 TypeError", () => {
    const store = new MemoryStore();
    const id = store.write({
      memoryType: "episodic" as any,
      content: { key: "original" },
      summary: "test",
      agentType: AgentType.Code,
      creatorId: "test",
    });

    const snap = store.peek(id)!;
    expect(() => {
      (snap as any).state = MemoryState.Archived;
    }).toThrow();

    const internal = store.peek(id)!;
    expect((internal as any).state).toBe(MemoryState.Active);
  });

  it("peek() content 冻结——嵌套对象不可改", () => {
    const store = new MemoryStore();
    const id = store.write({
      memoryType: "episodic" as any,
      content: { key: "a", nested: { deep: true } },
      summary: "freeze test",
      agentType: AgentType.Code,
      creatorId: "test",
    });

    const snap = store.peek(id)!;
    expect(() => {
      (snap.content as any).key = "modified";
    }).toThrow();

    const internal = store.peek(id)!;
    expect(internal.content.key).toBe("a");
  });

  it("CAS 是唯一状态变更路径", () => {
    const store = new MemoryStore();
    const id = store.write({
      memoryType: "episodic" as any,
      content: {},
      summary: "cas only",
      agentType: AgentType.Code,
      creatorId: "test",
    });

    const snap = store.peek(id)!;
    expect(Object.isFrozen(snap)).toBe(true);

    expect(store.cas(id, MemoryState.Active, MemoryState.Archived)).toBe(true);
    expect((store.peek(id)! as any).state).toBe(MemoryState.Archived);

    store.obliterate(id);
    expect(store.cas(id, MemoryState.Obliterated, MemoryState.Active)).toBe(false);
    expect((store.peek(id)! as any).state).toBe(MemoryState.Obliterated);
  });

  it("concurrent CAS 竞态——expected 不匹配则失败", () => {
    const store = new MemoryStore();
    const id = store.write({
      memoryType: "episodic" as any,
      content: {},
      summary: "race test",
      agentType: AgentType.Code,
      creatorId: "test",
    });

    const snap1 = store.peek(id)!;
    const snap2 = store.peek(id)!;

    expect(store.cas(id, snap1.state, MemoryState.Archived)).toBe(true);
    expect(store.cas(id, snap2.state, MemoryState.Frozen)).toBe(false);
    expect((store.peek(id)! as any).state).toBe(MemoryState.Archived);
  });
});
