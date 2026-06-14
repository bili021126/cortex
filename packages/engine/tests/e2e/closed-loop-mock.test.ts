// @ci
/**
 * 闭环协作 Mock E2E —— 模拟 MetaAgent 规划 → CodeAgent 实现 → ReviewAgent 审查
 *
 * 与 tests/manual/e2e/closed-loop-collab.ts 的差异：
 *   - 不依赖真实 LLM / API 密钥 / 文件系统
 *   - 使用 E2eMockFactory 注入预定义 Agent 响应
 *   - 可纳入 CI 门禁自动执行
 *   - 验证 Scheduler 调度 + Agent 标签匹配 + 多Agent协作流程
 */
import { describe, it, expect, beforeEach } from "vitest";
import { AgentType, type TaskNode } from "@cortex/shared";
import {
  TaskBoard,
  AgentPool,
  Scheduler,
  PipelineObserver,
  ConfirmGate,
  createAgent,
  codeAgentConfig,
  reviewAgentConfig} from "@cortex/engine";
import { Toolkit } from "@cortex/platform";
import { createE2eMockFactory, type E2eMockFactory } from "../fixtures/mock-llm-factory.js";

describe("闭环协作 Mock E2E", () => {
  let factory: E2eMockFactory;
  let board: TaskBoard;
  let pool: AgentPool;
  let observer: PipelineObserver;
  let gate: ConfirmGate;
  let scheduler: Scheduler;

  beforeEach(() => {
    factory = createE2eMockFactory();
    board = new TaskBoard();
    pool = new AgentPool();
    observer = new PipelineObserver();
    gate = new ConfirmGate();
    scheduler = new Scheduler(board, pool, observer);
  });

  it("CodeAgent 实现 → ReviewAgent 审查 → 闭环通过", async () => {
    // 注册 Agent 池
    pool.register({ type: AgentType.Code, maxInstances: 2 });
    pool.register({ type: AgentType.Review, maxInstances: 2 });

    // 创建 mock Agent
    const codeAdapter = factory.forCode("function add(a: number, b: number): number { return a + b; }");
    const reviewAdapter = factory.forReview("Code follows all conventions. 0 defects found.", 0);

    const codeAgent = createAgent(codeAgentConfig("mock"), codeAdapter, new Toolkit());
    const reviewAgent = createAgent(reviewAgentConfig("mock"), reviewAdapter, new Toolkit());
    await codeAgent.wakeup();
    await reviewAgent.wakeup();

    scheduler.register(AgentType.Code, codeAgent, "code-1");
    scheduler.register(AgentType.Review, reviewAgent, "review-1");

    // 添加任务节点
    board.addNode({
      id: "impl-1",
      type: "implementation",
      tags: ["code"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "Implement an add function in TypeScript.",
      results: [],
      createdAt: Date.now()});

    board.addNode({
      id: "review-1",
      type: "code_review",
      tags: ["review"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "Review the add function implementation.",
      results: [],
      createdAt: Date.now()});

    // 执行调度
    const report = await scheduler.executeAll();

    // 验证：所有节点完成
    expect(report.completed).toBe(2);
    expect(report.failed).toBe(0);

    // 验证：CodeAgent 产出代码
    const implNode = board.getNode("impl-1")!;
    expect(implNode.status).toBe("done");
    expect(implNode.results[0].agentType).toBe(AgentType.Code);

    // 验证：ReviewAgent 产出审查报告
    const reviewNode = board.getNode("review-1")!;
    expect(reviewNode.status).toBe("done");
    expect(reviewNode.results[0].agentType).toBe(AgentType.Review);
    expect(reviewNode.results[0].output).toContain("0 defects");
  });

  it("CodeAgent 实现 → ReviewAgent 发现缺陷 → 修复闭环", async () => {
    // 第一轮：实现 + 审查（发现 bug）
    {
      pool.register({ type: AgentType.Code, maxInstances: 2 });
      pool.register({ type: AgentType.Review, maxInstances: 2 });

      const buggyCodeAdapter = factory.forCode("function add(a, b) { return a - b; }");
      const reviewAdapter = factory.forReview(
        "Bug found: add function subtracts instead of adding. Line 1.",
        1,
      );

      const buggyAgent = createAgent(codeAgentConfig("mock"), buggyCodeAdapter, new Toolkit());
      const reviewer = createAgent(reviewAgentConfig("mock"), reviewAdapter, new Toolkit());
      await buggyAgent.wakeup();
      await reviewer.wakeup();

      scheduler.register(AgentType.Code, buggyAgent, "code");
      scheduler.register(AgentType.Review, reviewer, "review");

      board.addNode({
        id: "impl-round1",
        type: "implementation",
        tags: ["code"],
        needsMultiPerspective: false, status: "pending", claimedBy: [],
        payload: "Implement add(a,b).", results: [], createdAt: Date.now()});
      board.addNode({
        id: "review-round1",
        type: "code_review",
        tags: ["review"],
        needsMultiPerspective: false, status: "pending", claimedBy: [],
        payload: "Review the implementation.", results: [], createdAt: Date.now()});

      await scheduler.executeAll();
      expect(board.getNode("review-round1")!.results[0].output).toContain("Bug found");
    }

    // 第二轮：修复 + 再审查（新 Scheduler 实例）
    {
      const board2 = new TaskBoard();
      const pool2 = new AgentPool();
      const observer2 = new PipelineObserver();
      pool2.register({ type: AgentType.Code, maxInstances: 2 });
      pool2.register({ type: AgentType.Review, maxInstances: 2 });
      const scheduler2 = new Scheduler(board2, pool2, observer2);

      const fixAdapter = factory.forCode("function add(a: number, b: number): number { return a + b; }");
      const reReviewAdapter = factory.forReview("Fix confirmed. 0 defects remaining.", 0);

      const fixAgent = createAgent(codeAgentConfig("mock"), fixAdapter, new Toolkit());
      const reReviewer = createAgent(reviewAgentConfig("mock"), reReviewAdapter, new Toolkit());
      await fixAgent.wakeup();
      await reReviewer.wakeup();

      scheduler2.register(AgentType.Code, fixAgent, "code");
      scheduler2.register(AgentType.Review, reReviewer, "review");

      board2.addNode({
        id: "fix-round2",
        type: "bugfix",
        tags: ["code", "fix"],
        needsMultiPerspective: false, status: "pending", claimedBy: [],
        payload: "Fix: add function subtracts instead of adding.", results: [], createdAt: Date.now()});
      board2.addNode({
        id: "re-review-round2",
        type: "code_review",
        tags: ["review"],
        needsMultiPerspective: false, status: "pending", claimedBy: [],
        payload: "Verify the fix.", results: [], createdAt: Date.now()});

      const report2 = await scheduler2.executeAll();
      expect(report2.completed).toBe(2);
      expect(board2.getNode("re-review-round2")!.results[0].output).toContain("0 defects");
    }
  });

  it("多 Agent 并行协作——Code + Review + Analysis 同时执行", async () => {
    pool.register({ type: AgentType.Code, maxInstances: 2 });
    pool.register({ type: AgentType.Review, maxInstances: 2 });
    pool.register({ type: AgentType.Analysis, maxInstances: 2 });

    const codeAdapter = factory.forCode("export const PI = 3.14159;");
    const reviewAdapter = factory.forReview("Constant definition is correct. 0 defects.", 0);
    const analysisAdapter = factory.forAnalysis("Module uses simple constant export pattern. No architectural concerns.");

    const codeAgent = createAgent(codeAgentConfig("mock"), codeAdapter, new Toolkit());
    const reviewAgent = createAgent(reviewAgentConfig("mock"), reviewAdapter, new Toolkit());
    const analysisAgent = createAgent(
      { type: AgentType.Analysis, systemPrompt: "mock", memoryEnabled: false },
      analysisAdapter,
      new Toolkit(),
    );

    await codeAgent.wakeup();
    await reviewAgent.wakeup();
    await analysisAgent.wakeup();

    scheduler.register(AgentType.Code, codeAgent, "code");
    scheduler.register(AgentType.Review, reviewAgent, "review");
    scheduler.register(AgentType.Analysis, analysisAgent, "analysis");

    // 三个并行任务
    board.addNode({
      id: "impl",
      type: "implementation",
      tags: ["code"],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Define PI constant.", results: [], createdAt: Date.now()});
    board.addNode({
      id: "review",
      type: "code_review",
      tags: ["review"],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Review PI constant.", results: [], createdAt: Date.now()});
    board.addNode({
      id: "analysis",
      type: "architecture_analysis",
      tags: ["analysis"],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Analyze module architecture.", results: [], createdAt: Date.now()});

    const report = await scheduler.executeAll();

    expect(report.completed).toBe(3);
    expect(report.failed).toBe(0);

    // 每个 Agent 都执行了正确的节点类型
    const implNode = board.getNode("impl")!;
    expect(implNode.results[0].agentType).toBe(AgentType.Code);
    const reviewNode = board.getNode("review")!;
    expect(reviewNode.results[0].agentType).toBe(AgentType.Review);
    const analysisNode = board.getNode("analysis")!;
    expect(analysisNode.results[0].agentType).toBe(AgentType.Analysis);
  });
});
