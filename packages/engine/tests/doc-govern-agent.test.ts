import { describe, it, expect, beforeEach } from "vitest";
import { AgentType, MemoryType, PipelinePriority } from "@cortex/shared";
import { TaskBoard } from "../src/task-board";
import { AgentPool } from "../src/agent-pool";
import { PipelineObserver } from "../src/pipeline-observer";
import { ConfirmGate } from "../src/confirm-gate";
import { LlmAdapter } from "../src/llm-adapter";
import { Toolkit } from "../src/toolkit";
import { CodeAgent } from "../src/code-agent";
import { ReviewAgent } from "../src/review-agent";
import { AnalysisAgent } from "../src/analysis-agent";
import { DocGovernAgent } from "../src/doc-govern-agent";
import { MemoryStore } from "../src/memory-store";
import { Scheduler } from "../src/scheduler";

/** 创建 Mock Adapter */
function mockAdapter(output: string) {
  const adapter = new LlmAdapter({
    apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
  });
  adapter.injectMock(async () => ({ content: output, toolCalls: [] }));
  return adapter;
}

/** 按类型创建 Mock Agent */
async function mockAgent(agentType: string, output: string) {
  const adapter = mockAdapter(output);
  const tk = new Toolkit();
  let agent;
  switch (agentType) {
    case AgentType.Code: agent = new CodeAgent(adapter, tk); break;
    case AgentType.Review: agent = new ReviewAgent(adapter, tk); break;
    case AgentType.Analysis: agent = new AnalysisAgent(adapter, tk); break;
    case AgentType.DocGovern: agent = new DocGovernAgent(adapter, tk); break;
    default: agent = new CodeAgent(adapter, tk);
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
    board = new TaskBoard();
    pool = new AgentPool();
    observer = new PipelineObserver();
    gate = new ConfirmGate();

    // 注册包括 DocGovern 的所有 Agent 类型
    for (const at of [AgentType.Code, AgentType.Review, AgentType.Analysis, AgentType.DocGovern]) {
      pool.register({ type: at, maxInstances: 3 });
    }

    scheduler = new Scheduler(board, pool, observer, gate);

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
      createdAt: Date.now(),
    });

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
      createdAt: Date.now(),
    });

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
      createdAt: Date.now(),
    });

    const report = await scheduler.executeAll();

    expect(report.completed).toBe(1);
    expect(report.results[0].agentType).toBe(AgentType.DocGovern);
    expect(report.results[0].success).toBe(true);
  });

  it("DocGovernAgent 产出写入 EPISODIC 记忆", async () => {
    const memory = new MemoryStore();

    const adapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    adapter.injectMock(async () => ({
      content: "审计通过：无违规项",
      toolCalls: [],
    }));
    const agentWithMem = new DocGovernAgent(adapter, new Toolkit(), memory);

    const memScheduler = new Scheduler(board, pool, observer, gate);
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
      createdAt: Date.now(),
    });

    await memScheduler.executeAll();

    const mems = memory.read({ memoryTypes: [MemoryType.Episodic] });
    expect(mems.length).toBeGreaterThanOrEqual(1);
    expect(mems[0].agentType).toBe(AgentType.DocGovern);
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
      createdAt: Date.now(),
    });
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
      createdAt: Date.now(),
    });

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
