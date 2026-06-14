// @ci
/**
 * 多 Agent 协作 Mock E2E —— 不同 Agent 类型通过标签匹配协同完成复杂任务
 *
 * 覆盖场景：
 *   - Code + Review + Analysis 三路并行
 *   - 任务依赖链（前置节点完成后触发下游）
 *   - DocGovern 治理审计 + Fix 修复闭环
 */
import { describe, it, expect, beforeEach } from "vitest";
import { AgentType } from "@cortex/shared";
import {
  TaskBoard,
  AgentPool,
  Scheduler,
  PipelineObserver,
  ConfirmGate,
  createAgent,
  codeAgentConfig,
  reviewAgentConfig,
  analysisAgentConfig,
  docGovernAgentConfig} from "@cortex/engine";
import { Toolkit } from "@cortex/platform";
import { createE2eMockFactory } from "../fixtures/mock-llm-factory.js";

describe("多 Agent 协作 Mock E2E", () => {
  let factory = createE2eMockFactory();
  let board: TaskBoard;
  let pool: AgentPool;
  let observer: PipelineObserver;
  let scheduler: Scheduler;

  beforeEach(() => {
    factory = createE2eMockFactory();
    board = new TaskBoard();
    pool = new AgentPool();
    observer = new PipelineObserver();
    scheduler = new Scheduler(board, pool, observer);
  });

  it("Code + Review + Analysis 三路并行 → 全部完成", async () => {
    pool.register({ type: AgentType.Code, maxInstances: 2 });
    pool.register({ type: AgentType.Review, maxInstances: 2 });
    pool.register({ type: AgentType.Analysis, maxInstances: 2 });

    const codeAgent = createAgent(
      codeAgentConfig("mock"),
      factory.forCode("export const VERSION = '1.0.0';"),
      new Toolkit(),
    );
    const reviewAgent = createAgent(
      reviewAgentConfig("mock"),
      factory.forReview("No defects. Code is clean.", 0),
      new Toolkit(),
    );
    const analysisAgent = createAgent(
      analysisAgentConfig("mock"),
      factory.forAnalysis("Architecture is properly layered. All dependencies point inward."),
      new Toolkit(),
    );

    await codeAgent.wakeup();
    await reviewAgent.wakeup();
    await analysisAgent.wakeup();

    scheduler.register(AgentType.Code, codeAgent, "code");
    scheduler.register(AgentType.Review, reviewAgent, "review");
    scheduler.register(AgentType.Analysis, analysisAgent, "analysis");

    board.addNode({
      id: "impl",
      type: "implementation", tags: ["code"],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Implement version constant.", results: [], createdAt: Date.now()});
    board.addNode({
      id: "review",
      type: "code_review", tags: ["review"],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Review version implementation.", results: [], createdAt: Date.now()});
    board.addNode({
      id: "analysis",
      type: "architecture_analysis", tags: ["analysis"],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Analyze module architecture.", results: [], createdAt: Date.now()});

    const report = await scheduler.executeAll();

    expect(report.completed).toBe(3);
    expect(report.failed).toBe(0);

    // 验证每个节点由正确类型的 Agent 执行
    expect(board.getNode("impl")!.results[0].agentType).toBe(AgentType.Code);
    expect(board.getNode("review")!.results[0].agentType).toBe(AgentType.Review);
    expect(board.getNode("analysis")!.results[0].agentType).toBe(AgentType.Analysis);
  });

  it("治理审计 → 发现违规 → Code + Fix 修复 → 再审计通过", async () => {
    // 注册完整的 Agent 池
    pool.register({ type: AgentType.Code, maxInstances: 3 });
    pool.register({ type: AgentType.Review, maxInstances: 2 });
    pool.register({ type: AgentType.DocGovern, maxInstances: 2 });

    // 第一轮：DocGovern 审计发现违规
    const auditAdapter1 = factory.forDocGovern(
      "## Audit Report\n\n- [!] Hardcoded path found in src/loader.ts:33\n- [!] console.error in src/handler.ts:12\n\n**Verdict: FAIL — 2 violations**",
    );
    const reviewAdapter1 = factory.forReview("Audit findings confirmed. 2 real violations.", 2);

    const docAgent1 = createAgent(docGovernAgentConfig("mock"), auditAdapter1, new Toolkit());
    const reviewer1 = createAgent(reviewAgentConfig("mock"), reviewAdapter1, new Toolkit());
    await docAgent1.wakeup();
    await reviewer1.wakeup();

    scheduler.register(AgentType.DocGovern, docAgent1, "doc-1");
    scheduler.register(AgentType.Review, reviewer1, "review-1");

    board.addNode({
      id: "audit-1",
      type: "constitution_check", tags: ["constitution_check"],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Audit codebase for coding standard violations.", results: [], createdAt: Date.now()});
    board.addNode({
      id: "verify-1",
      type: "code_review", tags: ["review"],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Verify audit findings.", results: [], createdAt: Date.now()});

    await scheduler.executeAll();
    expect(board.getNode("audit-1")!.results[0].output).toContain("FAIL");

    // 第二轮：修复违规（新 Scheduler）
    const board2 = new TaskBoard();
    const pool2 = new AgentPool();
    const observer2 = new PipelineObserver();
    pool2.register({ type: AgentType.Code, maxInstances: 2 });
    pool2.register({ type: AgentType.DocGovern, maxInstances: 2 });
    const scheduler2 = new Scheduler(board2, pool2, observer2);

    const fixAdapter = factory.forCode("// All hardcoded paths replaced with constants.");
    const auditAdapter2 = factory.forDocGovern(
      "## Re-Audit Report\n\n- [x] Hardcoded paths fixed\n- [x] console.error removed\n\n**Verdict: PASS**",
    );

    const fixAgent = createAgent(codeAgentConfig("mock"), fixAdapter, new Toolkit());
    const docAgent2 = createAgent(docGovernAgentConfig("mock"), auditAdapter2, new Toolkit());
    await fixAgent.wakeup();
    await docAgent2.wakeup();

    scheduler2.register(AgentType.Code, fixAgent, "fix");
    scheduler2.register(AgentType.DocGovern, docAgent2, "doc-2");

    board2.addNode({
      id: "fix-violations",
      type: "bugfix", tags: ["code", "fix"],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Fix 2 coding standard violations.", results: [], createdAt: Date.now()});
    board2.addNode({
      id: "re-audit",
      type: "constitution_check", tags: ["constitution_check"],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Re-audit after fixes.", results: [], createdAt: Date.now()});

    const report2 = await scheduler2.executeAll();
    expect(report2.completed).toBe(2);
    expect(board2.getNode("re-audit")!.results[0].output).toContain("PASS");
  });

  it("5 Agent 全类型注册——每种标签只匹配正确 Agent", async () => {
    // 注册 5 种 Agent 类型
    pool.register({ type: AgentType.Code, maxInstances: 1 });
    pool.register({ type: AgentType.Review, maxInstances: 1 });
    pool.register({ type: AgentType.Analysis, maxInstances: 1 });
    pool.register({ type: AgentType.DocGovern, maxInstances: 1 });

    const codeAgent = createAgent(codeAgentConfig("mock"), factory.forCode("OK"), new Toolkit());
    const reviewAgent = createAgent(reviewAgentConfig("mock"), factory.forReview("OK", 0), new Toolkit());
    const analysisAgent = createAgent(analysisAgentConfig("mock"), factory.forAnalysis("OK"), new Toolkit());
    const docAgent = createAgent(docGovernAgentConfig("mock"), factory.forDocGovern("PASS"), new Toolkit());

    await codeAgent.wakeup();
    await reviewAgent.wakeup();
    await analysisAgent.wakeup();
    await docAgent.wakeup();

    scheduler.register(AgentType.Code, codeAgent, "c");
    scheduler.register(AgentType.Review, reviewAgent, "r");
    scheduler.register(AgentType.Analysis, analysisAgent, "a");
    scheduler.register(AgentType.DocGovern, docAgent, "d");

    // 添加 4 个不同类型的节点
    board.addNode({
      id: "n-code", type: "implementation", tags: ["code" as const],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Write code.", results: [], createdAt: Date.now()});
    board.addNode({
      id: "n-review", type: "code_review", tags: ["review" as const],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Review code.", results: [], createdAt: Date.now()});
    board.addNode({
      id: "n-analysis", type: "analysis", tags: ["analysis" as const],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Analyze.", results: [], createdAt: Date.now()});
    board.addNode({
      id: "n-doc", type: "constitution_check", tags: ["constitution_check" as const],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Audit.", results: [], createdAt: Date.now()});

    const report = await scheduler.executeAll();

    expect(report.completed).toBe(4);
    // 标签匹配正确性——每个节点被正确类型的 Agent 执行
    expect(board.getNode("n-code")!.results[0].agentType).toBe(AgentType.Code);
    expect(board.getNode("n-review")!.results[0].agentType).toBe(AgentType.Review);
    expect(board.getNode("n-analysis")!.results[0].agentType).toBe(AgentType.Analysis);
    expect(board.getNode("n-doc")!.results[0].agentType).toBe(AgentType.DocGovern);
  });
});
