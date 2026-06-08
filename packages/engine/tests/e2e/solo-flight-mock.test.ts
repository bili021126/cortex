// @ci
/**
 * Solo Flight Mock E2E —— 单 Agent 全类型全链路的完整路径模拟
 *
 * 覆盖场景（8 项）：
 *   - CodeAgent: 读取→修改→写入→验证（5步工具链）
 *   - CodeAgent: 首次工具调用报错后自适应重试成功
 *   - CodeAgent ×2: 并行执行不同任务互不干扰
 *   - FixAgent: 缺陷报告→读取→诊断→修复→写回→验证（自愈闭环）
 *   - AnalysisAgent: 搜索代码库→分析依赖→产出架构报告
 *   - OpsAgent: 执行shell→验证输出→状态报告
 *   - CodeAgent: 连续 3 次工具失败后仍成功恢复（压力韧性）
 *   - 大规模调度: 5 节点 × 3 种 Agent 类型同 scheduler 并发执行
 *
 * 所有 LLM 调用使用 E2eMockFactory / mockScriptAdapter 注入预定义响应。
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
  codeAgentConfig,
  fixAgentConfig,
  analysisAgentConfig,
  opsAgentConfig,
  loopAgentConfig} from "@cortex/engine";
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

  // ─── 新增测试 1: FixAgent 自愈闭环 ─────────────────────

  it("FixAgent 自愈闭环——缺陷报告→读取→诊断→修复→写回→验证", async () => {
    pool.register({ type: AgentType.Fix, maxInstances: 2 });

    // 模拟 FixAgent 的完整自愈链路：读取缺陷报告 → 定位源码 → 读源码 → 修复 → 写回 → 验证
    const adapter = mockScriptAdapter([
      {
        content: "Reading the defect report first.",
        toolCalls: [{ name: "read_file", arguments: { file_path: "review-report.md" } }]},
      {
        content: "Defect D-01: null check missing at src/handler.ts:42. Now reading the source.",
        toolCalls: [{ name: "read_file", arguments: { file_path: "src/handler.ts" } }]},
      {
        content: "Found the issue. Applying the fix with a null guard.",
        toolCalls: [{ name: "write_file", arguments: { file_path: "src/handler.ts", content: "export function handler(input: string | null): string { if (input === null) return ''; return input.trim(); }" } }]},
      {
        content: "Fix applied. Now verifying with tests.",
        toolCalls: [{ name: "run_shell", arguments: { command: "pnpm vitest run --reporter=verbose" } }]},
      {
        content: "All 12 tests pass. Defect D-01 closed."},
    ]);

    const fixAgent = createAgent(fixAgentConfig("mock"), adapter, new Toolkit());
    await fixAgent.wakeup();
    scheduler.register(AgentType.Fix, fixAgent, "fix-solo");

    board.addNode({
      id: "fix-d01",
      type: "bugfix",
      tags: ["fix", "bugfix"],
      needsMultiPerspective: false,
      status: "pending", claimedBy: [],
      payload: "修复审查报告中的缺陷 D-01: null check missing at src/handler.ts:42",
      results: [], createdAt: Date.now()});

    const report = await scheduler.executeAll();
    expect(report.completed).toBe(1);
    expect(report.failed).toBe(0);

    const node = board.getNode("fix-d01")!;
    expect(node.status).toBe("done");
    expect(node.results[0].agentType).toBe(AgentType.Fix);
    expect(node.results[0].success).toBe(true);
    expect(node.results[0].output).toContain("D-01 closed");
  });

  // ─── 新增测试 2: AnalysisAgent solo 架构扫描 ────────────

  it("AnalysisAgent solo 架构扫描——搜索→分析→产出报告", async () => {
    pool.register({ type: AgentType.Analysis, maxInstances: 2 });

    const adapter = mockScriptAdapter([
      {
        content: "Scanning the codebase for module boundaries.",
        toolCalls: [{ name: "search_code", arguments: { query: "export.*class|export.*function|import.*from" } }]},
      {
        content: "Found 15 cross-module imports. Searching for circular dependencies.",
        toolCalls: [{ name: "search_code", arguments: { query: "packages/.*import.*from.*packages" } }]},
      {
        content: "No circular dependencies detected. Writing analysis report.",
        toolCalls: [{ name: "write_file", arguments: { file_path: "architecture-report.md", content: "## Architecture Analysis\n\n- 15 cross-module imports\n- 0 circular dependencies\n- Dependency direction: strictly unidirectional\n- All packages follow barrel export convention\n\n**Verdict: CLEAN**" } }]},
      {
        content: "## Architecture Analysis\n\n- 15 cross-module imports\n- 0 circular dependencies\n- Dependency direction: strictly unidirectional\n- All packages follow barrel export convention\n\n**Verdict: CLEAN**"},
    ]);

    const analysisAgent = createAgent(analysisAgentConfig("mock"), adapter, new Toolkit());
    await analysisAgent.wakeup();
    scheduler.register(AgentType.Analysis, analysisAgent, "analysis-solo");

    board.addNode({
      id: "arch-scan",
      type: "architecture_analysis",
      tags: ["analysis"],
      needsMultiPerspective: false,
      status: "pending", claimedBy: [],
      payload: "扫描 monorepo 的模块依赖架构",
      results: [], createdAt: Date.now()});

    const report = await scheduler.executeAll();
    expect(report.completed).toBe(1);
    expect(report.failed).toBe(0);

    const node = board.getNode("arch-scan")!;
    expect(node.status).toBe("done");
    expect(node.results[0].agentType).toBe(AgentType.Analysis);
    expect(node.results[0].output).toContain("CLEAN");
    expect(node.results[0].output).toContain("0 circular");
  });

  // ─── 新增测试 3: OpsAgent solo 运维执行 ──────────────────

  it("OpsAgent solo 运维执行——shell→验证→状态报告", async () => {
    pool.register({ type: AgentType.Ops, maxInstances: 2 });

    const adapter = mockScriptAdapter([
      {
        content: "Running the test suite.",
        toolCalls: [{ name: "run_shell", arguments: { command: "pnpm vitest run --reporter=json" } }]},
      {
        content: "Tests completed. Checking coverage.",
        toolCalls: [{ name: "run_shell", arguments: { command: "pnpm vitest run --coverage" } }]},
      {
        content: "## Ops Report\n\n- Test suite: 354/354 passed\n- Coverage: 87.3% lines, 92.1% branches\n- Build: success (tsc --noEmit clean)\n- Lint: 0 errors, 0 warnings\n\n**Status: HEALTHY**"},
    ]);

    const opsAgent = createAgent(opsAgentConfig("mock"), adapter, new Toolkit());
    await opsAgent.wakeup();
    scheduler.register(AgentType.Ops, opsAgent, "ops-solo");

    board.addNode({
      id: "ops-check",
      type: "test",
      tags: ["ops", "test"],
      needsMultiPerspective: false,
      status: "pending", claimedBy: [],
      payload: "运行全量测试套件并报告覆盖率",
      results: [], createdAt: Date.now()});

    const report = await scheduler.executeAll();
    expect(report.completed).toBe(1);
    expect(report.failed).toBe(0);

    const node = board.getNode("ops-check")!;
    expect(node.status).toBe("done");
    expect(node.results[0].agentType).toBe(AgentType.Ops);
    expect(node.results[0].output).toContain("HEALTHY");
    expect(node.results[0].output).toContain("354/354");
  });

  // ─── 新增测试 4: CodeAgent 连续错误恢复压力 ──────────────

  it("CodeAgent 连续 3 次工具失败后自适应恢复成功", async () => {
    pool.register({ type: AgentType.Code, maxInstances: 2 });

    // 模拟连续失败的压力场景：read_file 报不存在 → search_code 不可用 → list_files 报权限错误 → 最终成功
    const adapter = mockScriptAdapter([
      // 第 1 次尝试：read_file 失败
      {
        content: "Let me read the target file.",
        toolCalls: [{ name: "read_file", arguments: { file_path: "src/nonexistent.ts" } }]},
      // read_file 返回 error（由 Toolkit handler 产生）→ Agent 收到后决定换策略
      {
        content: "File not found. Let me search for it instead.",
        toolCalls: [{ name: "search_code", arguments: { query: "nonexistent" } }]},
      // search_code 也失败（rg 不可用）
      {
        content: "Search tool unavailable. Let me try listing the directory.",
        toolCalls: [{ name: "list_files", arguments: { file_path: "src/" } }]},
      // list_files 成功——Agent 找到了正确的文件
      {
        content: "Found it: src/handler.ts exists. Reading it now.",
        toolCalls: [{ name: "read_file", arguments: { file_path: "src/handler.ts" } }]},
      // 读取成功，开始修复
      {
        content: "Read the file. Now applying the fix.",
        toolCalls: [{ name: "write_file", arguments: { file_path: "src/handler.ts", content: "export const FIXED = true;" } }]},
      // 验证
      {
        content: "Fix applied. Running verification.",
        toolCalls: [{ name: "run_shell", arguments: { command: "pnpm vitest run" } }]},
      { content: "All tests pass. Recovery successful after 3 failed attempts."},
    ]);

    const agent = createAgent(codeAgentConfig("mock"), adapter, new Toolkit());
    await agent.wakeup();
    scheduler.register(AgentType.Code, agent, "resilient");

    board.addNode({
      id: "resilient-task",
      type: "bugfix",
      tags: ["code", "fix"],
      needsMultiPerspective: false,
      status: "pending", claimedBy: [],
      payload: "修复 src/handler.ts 的导出问题——文件位置不确定，需要自行探索",
      results: [], createdAt: Date.now()});

    const report = await scheduler.executeAll();
    expect(report.completed).toBe(1);
    expect(report.failed).toBe(0);

    const node = board.getNode("resilient-task")!;
    expect(node.status).toBe("done");
    expect(node.results[0].success).toBe(true);
    expect(node.results[0].output).toContain("Recovery successful");
  });

  // ─── 新增测试 5: 大规模调度压力 ──────────────────────

  it("5 节点 × 3 Agent 类型同 scheduler 并发——全部完成", async () => {
    pool.register({ type: AgentType.Code, maxInstances: 3 });
    pool.register({ type: AgentType.Analysis, maxInstances: 2 });
    pool.register({ type: AgentType.Fix, maxInstances: 2 });

    const factory = createE2eMockFactory();

    // 创建多个 Agent 实例
    const code1 = createAgent(codeAgentConfig("mock"), factory.forCode("export const A = 1;"), new Toolkit());
    const code2 = createAgent(codeAgentConfig("mock"), factory.forCode("export const B = 2;"), new Toolkit());
    const code3 = createAgent(codeAgentConfig("mock"), factory.forCode("export const C = 3;"), new Toolkit());
    const analysis = createAgent(analysisAgentConfig("mock"), factory.forAnalysis("Three modules, no coupling, clean architecture."), new Toolkit());
    const fix = createAgent(fixAgentConfig("mock"), factory.forFix("export const D = 4;", 1), new Toolkit());

    await code1.wakeup(); await code2.wakeup(); await code3.wakeup();
    await analysis.wakeup(); await fix.wakeup();

    scheduler.register(AgentType.Code, code1, "code-1");
    scheduler.register(AgentType.Code, code2, "code-2");
    scheduler.register(AgentType.Code, code3, "code-3");
    scheduler.register(AgentType.Analysis, analysis, "analysis-1");
    scheduler.register(AgentType.Fix, fix, "fix-1");

    // 添加 5 个不同类型节点
    const nodes = [
      { id: "impl-a", type: "implementation", tags: ["code" as const], payload: "Implement module A" },
      { id: "impl-b", type: "implementation", tags: ["code" as const], payload: "Implement module B" },
      { id: "impl-c", type: "implementation", tags: ["code" as const], payload: "Implement module C" },
      { id: "arch-review", type: "architecture_analysis", tags: ["analysis" as const], payload: "Review architecture of A/B/C" },
      { id: "fix-d", type: "bugfix", tags: ["fix" as const], payload: "Fix defect in module D" },
    ];

    for (const n of nodes) {
      board.addNode({
        ...n,
        needsMultiPerspective: false,
        status: "pending", claimedBy: [],
        results: [], createdAt: Date.now()});
    }

    const report = await scheduler.executeAll();

    // 全部 5 个节点应完成
    expect(report.completed).toBe(5);
    expect(report.failed).toBe(0);

    // 标签匹配正确性
    expect(board.getNode("impl-a")!.results[0].agentType).toBe(AgentType.Code);
    expect(board.getNode("impl-b")!.results[0].agentType).toBe(AgentType.Code);
    expect(board.getNode("impl-c")!.results[0].agentType).toBe(AgentType.Code);
    expect(board.getNode("arch-review")!.results[0].agentType).toBe(AgentType.Analysis);
    expect(board.getNode("fix-d")!.results[0].agentType).toBe(AgentType.Fix);
  });
});
