// @ci: unit
import { describe, it, expect, beforeEach } from "vitest";
import { AgentType, PipelinePriority } from "@cortex/shared";
import { TaskBoard, AgentPool, PipelineObserver, ConfirmGate, ManifoldGate } from "@cortex/scheduler";
import { createAgent, codeAgentConfig, reviewAgentConfig, analysisAgentConfig, docGovernAgentConfig, Scheduler } from "@cortex/engine";
import { Toolkit } from "@cortex/platform";
import { MemoryStore } from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";
import { LlmAdapter } from "@cortex/llm";

/** mock embedder: 生成伪向量 */
function mockEmbedder() {
  const dim = 384;
  function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return h; }
  function vec(seed: number) { let v = new Array(dim), s = seed; for (let i = 0; i < dim; i++) { s = (1664525 * s + 1013904223) | 0; v[i] = s / 2147483647; } let n = 0; for (let x of v) n += x * x; n = Math.sqrt(n); for (let i = 0; i < dim; i++) v[i] /= n; return v; }
  return { async embedText(t: string) { return vec(hash(t)); }, async embedBatch(ts: string[]) { return ts.map(t => vec(hash(t))); } };
}

/** 创建 Mock Adapter */
function mockAdapter(output: string) {
  const adapter = new LlmAdapter({
    apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock"});
  adapter.injectMock(async () => ({ content: output, toolCalls: [] }));
  return adapter;
}

/** 按类型创建 Mock Agent */
async function mockAgent(agentType: string, output: string) {
  const adapter = mockAdapter(output);
  const tk = new Toolkit();
  let agent;
  switch (agentType) {
    case AgentType.Code: agent = createAgent(codeAgentConfig("Test"), adapter, tk); break;
    case AgentType.Review: agent = createAgent(reviewAgentConfig("Test"), adapter, tk); break;
    case AgentType.Analysis: agent = createAgent(analysisAgentConfig("Test"), adapter, tk); break;
    case AgentType.DocGovern: agent = createAgent(docGovernAgentConfig("Test"), adapter, tk); break;
    default: agent = createAgent(codeAgentConfig("Test"), adapter, tk);
  }
  await agent.wakeup();
  return agent;
}

describe("DocGovernAgent 执行", () => {
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

    // 注册包括 DocGovern 的所有 Agent 类型
    for (const at of [AgentType.Code, AgentType.Review, AgentType.Analysis, AgentType.DocGovern]) {
      pool.register({ type: at, maxInstances: 3 });
    }

    scheduler = new Scheduler(board, pool, observer);

    const auditReport = [
      "## 审计报告",
      "",
      "### 检查项目",
      "- [x] 文档格式一致性",
      "- [x] 宪法条款引用正确性",
      "- [!] 发现 1 处文档遗漏：Core-1 重构计划未标注第四轮退出标准",
      "",
      "### 结论",
      "治理审计通过，1 项改进建议。",
    ].join("\n");

    scheduler.register(AgentType.Code, await mockAgent(AgentType.Code, "实现完成"), "mock");
    scheduler.register(AgentType.Review, await mockAgent(AgentType.Review, "审查通过"), "mock");
    scheduler.register(AgentType.Analysis, await mockAgent(AgentType.Analysis, "分析完成"), "mock");
    scheduler.register(AgentType.DocGovern, await mockAgent(AgentType.DocGovern, auditReport), "mock");
  });

  it("doc_audit 标签节点由 DocGovernAgent 执行", async () => {
    board.addNode({
      id: "audit-1",
      type: "doc_audit",
      tags: ["doc_audit"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "审计 Core-1 重构计划文档的完整性与合规性",
      results: [],
      createdAt: Date.now()});

    const report = await scheduler.executeAll();

    expect(report.totalNodes).toBe(1);
    expect(report.completed).toBe(1);
    expect(report.failed).toBe(0);

    const node = board.getNode("audit-1")!;
    expect(node.status).toBe("done");
    expect(node.results[0].agentType).toBe(AgentType.DocGovern);
    expect(node.results[0].output).toContain("审计报告");
    expect(node.results[0].output).toContain("文档格式一致性");
  });

  it("constitution_check 标签节点由 DocGovernAgent 执行", async () => {
    board.addNode({
      id: "const-check-1",
      type: "constitution_check",
      tags: ["constitution_check"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "检查 v2.0 宪法修正附录与原始文档的一致性",
      results: [],
      createdAt: Date.now()});

    const report = await scheduler.executeAll();

    expect(report.totalNodes).toBe(1);
    expect(report.completed).toBe(1);
    expect(report.results[0].agentType).toBe(AgentType.DocGovern);
    expect(report.results[0].output).toContain("宪法条款");
  });

  it("plan_review 标签节点由 DocGovernAgent 执行", async () => {
    board.addNode({
      id: "plan-review-1",
      type: "plan_review",
      tags: ["plan_review"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "审查 Core-1 Round 4 实施计划的可行性",
      results: [],
      createdAt: Date.now()});

    const report = await scheduler.executeAll();

    expect(report.completed).toBe(1);
    expect(report.results[0].agentType).toBe(AgentType.DocGovern);
    expect(report.results[0].success).toBe(true);
  });

  it("DocGovernAgent 产出写入 EPISODIC 记忆", async () => {
    const memory = new MemoryStore(new InMemoryMemoryStore(), undefined, mockEmbedder());
    await memory.init(":memory:");

    const adapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock"});
    adapter.injectMock(async () => ({
      content: "审计通过：无违规项",
      toolCalls: []}));
    const agentWithMem = createAgent(docGovernAgentConfig("Test"), adapter, new Toolkit(), memory);

    const memScheduler = new Scheduler(board, pool, observer);
    await agentWithMem.wakeup();
    memScheduler.register(AgentType.DocGovern, agentWithMem, "mock");

    board.addNode({
      id: "mem-audit",
      type: "doc_audit",
      tags: ["doc_audit"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "审计记忆写入测试",
      results: [],
      createdAt: Date.now()});

    await memScheduler.executeAll();

    const mems = await memory.read({ kind: "TaskLog" });
    expect(mems.length).toBeGreaterThanOrEqual(1);
    expect(mems[0].source.agentType).toBe(AgentType.DocGovern);
  });

  it("DocGovernAgent 与其他 Agent 在串行链路中协作", async () => {
    // 场景：CodeAgent 产出 → DocGovernAgent 审计
    board.addNode({
      id: "impl-root",
      type: "implementation",
      tags: ["implementation"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "实现新功能",
      results: [],
      createdAt: Date.now()});
    board.addNode({
      id: "audit-child",
      parentId: "impl-root",
      type: "doc_audit",
      tags: ["doc_audit"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "审计产出文档",
      results: [],
      createdAt: Date.now()});

    const events: string[] = [];
    observer.on(PipelinePriority.HIGH, (e: any) => {
      if (e.type === "node.complete") {
        events.push(`${e.payload.nodeId}:${e.payload.agentType}`);
      }
    });

    const report = await scheduler.executeAll();

    expect(report.totalNodes).toBe(2);
    expect(report.completed).toBe(2);
    expect(report.failed).toBe(0);

    // 父节点先完成（CodeAgent），子节点后完成（DocGovernAgent）
    expect(events).toHaveLength(2);
    expect(events[0]).toBe("impl-root:code");
    expect(events[1]).toBe("audit-child:doc-govern");
  });
});
