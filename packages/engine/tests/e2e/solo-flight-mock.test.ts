// @ci
/**
 * Solo Flight Mock E2E —— 单 Agent 复杂多工具调用的完整链路模拟
 *
 * 模拟 CodeAgent 完成"读取已有代码 → 分析 → 修改 → 写入 → 运行测试"的完整 solo 流程。
 * 所有 LLM 调用使用 E2eMockFactory 注入预定义响应。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { AgentType } from "@cortex/shared";
import {
  TaskBoard,
  AgentPool,
  Scheduler,
  PipelineObserver,
  ConfirmGate,
  Toolkit,
  createAgent,
  codeAgentConfig} from "@cortex/engine";
import { createE2eMockFactory, mockScriptAdapter } from "../fixtures/mock-llm-factory.js";

describe("Solo Flight Mock E2E", () => {
  let board: TaskBoard;
  let pool: AgentPool;
  let observer: PipelineObserver;
  let scheduler: Scheduler;

  beforeEach(() => {
    board = new TaskBoard();
    pool = new AgentPool();
    observer = new PipelineObserver();
    scheduler = new Scheduler(board, pool, observer);
  });

  it("CodeAgent 读取代码 → 修改 → 写入 → 验证", async () => {
    pool.register({ type: AgentType.Code, maxInstances: 2 });

    // 模拟一个完整的 5 步工具调用序列
    const adapter = mockScriptAdapter([
      // 第 1 步：读取现有代码
      {
        content: "Let me read the existing file first.",
        toolCalls: [{ name: "read_file", arguments: { file_path: "src/utils.ts" } }]},
      // 第 2 步：搜索相关依赖
      {
        content: "Now let me check how this is used elsewhere.",
        toolCalls: [{ name: "search_code", arguments: { query: "import.*utils" } }]},
      // 第 3 步：写入修改后的代码
      {
        content: "Applying the fix.",
        toolCalls: [{ name: "write_file", arguments: { file_path: "src/utils.ts", content: "export const FIXED = true;" } }]},
      // 第 4 步：运行测试验证
      {
        content: "Running tests to verify.",
        toolCalls: [{ name: "run_shell", arguments: { command: "pnpm vitest run" } }]},
      // 第 5 步：最终总结
      {
        content: "All tests pass. Fix applied successfully."},
    ]);

    const agent = createAgent(codeAgentConfig("mock"), adapter, new Toolkit());
    await agent.wakeup();
    scheduler.register(AgentType.Code, agent, "solo");

    board.addNode({
      id: "solo-fix",
      type: "bugfix",
      tags: ["code", "fix"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "Fix the utils.ts export and verify with tests.",
      results: [],
      createdAt: Date.now()});

    const report = await scheduler.executeAll();
    expect(report.completed).toBe(1);
    expect(report.failed).toBe(0);

    const node = board.getNode("solo-fix")!;
    expect(node.status).toBe("done");
    expect(node.results[0].success).toBe(true);
  });

  it("CodeAgent 失败重试——首次工具调用报错后重试成功", async () => {
    pool.register({ type: AgentType.Code, maxInstances: 2 });

    // 模拟首次 read_file 失败，重试后成功
    const adapter = mockScriptAdapter([
      // 尝试读取——但 Agent 不知道文件不存在（mock 模拟正常流程）
      {
        content: "Reading the target file.",
        toolCalls: [{ name: "read_file", arguments: { file_path: "missing.ts" } }]},
      // "read_file" 工具执行返回 error（由 Toolkit 的默认 handler 决定）
      // Agent 收到错误后，决定搜索替代方案
      {
        content: "File not found, searching for alternatives.",
        toolCalls: [{ name: "search_code", arguments: { query: "missing" } }]},
      // 找到目标后写入
      {
        content: "Found the correct location. Applying fix.",
        toolCalls: [{ name: "write_file", arguments: { file_path: "src/correct.ts", content: "export const OK = true;" } }]},
      {
        content: "Fix applied to the correct file."},
    ]);

    const agent = createAgent(codeAgentConfig("mock"), adapter, new Toolkit());
    await agent.wakeup();
    scheduler.register(AgentType.Code, agent, "solo");

    board.addNode({
      id: "recovery-task",
      type: "bugfix",
      tags: ["code"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "Fix the missing reference.",
      results: [],
      createdAt: Date.now()});

    const report = await scheduler.executeAll();
    expect(report.completed).toBe(1);
    const node = board.getNode("recovery-task")!;
    expect(node.status).toBe("done");
  });

  it("两个 CodeAgent 并行执行不同任务——互不干扰", async () => {
    pool.register({ type: AgentType.Code, maxInstances: 3 });

    const factory = createE2eMockFactory();
    const adapter1 = factory.forCode("export const TASK_A = 'done';");
    const adapter2 = factory.forCode("export const TASK_B = 'done';");

    const agent1 = createAgent(codeAgentConfig("mock"), adapter1, new Toolkit());
    const agent2 = createAgent(codeAgentConfig("mock"), adapter2, new Toolkit());
    await agent1.wakeup();
    await agent2.wakeup();

    scheduler.register(AgentType.Code, agent1, "worker-1");
    scheduler.register(AgentType.Code, agent2, "worker-2");

    board.addNode({
      id: "task-a",
      type: "implementation",
      tags: ["code"],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Implement task A.", results: [], createdAt: Date.now()});
    board.addNode({
      id: "task-b",
      type: "implementation",
      tags: ["code"],
      needsMultiPerspective: false, status: "pending", claimedBy: [],
      payload: "Implement task B.", results: [], createdAt: Date.now()});

    const report = await scheduler.executeAll();
    expect(report.completed).toBe(2);
    expect(report.failed).toBe(0);

    const nodeA = board.getNode("task-a")!;
    const nodeB = board.getNode("task-b")!;
    expect(nodeA.status).toBe("done");
    expect(nodeB.status).toBe("done");
    // 两个节点都被正确认领并执行
    expect(nodeA.results.length).toBeGreaterThan(0);
    expect(nodeB.results.length).toBeGreaterThan(0);
  });
});
