/**
 * @ci 霜凝 (StrategistAgent) Mock E2E 测试
 *
 * 验证霜凝能接收 strategy/direction 标签并执行方向判断。
 * 使用 mock LLM 工厂避免真实 API 调用。
 */

import { describe, it, expect } from "vitest";
import { Scheduler, TaskBoard, AgentPool, PipelineObserver, createAgent, Toolkit } from "@cortex/engine";
import type { AgentFactoryConfig } from "@cortex/engine";
import { AgentType } from "@cortex/shared";
import { createE2eMockFactory } from "../fixtures/mock-llm-factory.js";

const mock = createE2eMockFactory();

describe("霜凝 StrategistAgent Mock E2E", () => {
  // ── 方向判断 ────────────────────────────────────

  it("霜凝接收 direction 标签，分析修复方向一致性", async () => {
    const observer = new PipelineObserver();
    const board = new TaskBoard();
    const pool = new AgentPool();
    const toolkit = new Toolkit();

    const scheduler = new Scheduler(board, pool, observer);

    // 注册 AgentPool 配额
    pool.register({ type: AgentType.Strategist, maxInstances: 3 });

    // 注册霜凝
    const llm = mock.forAnalysis(
      "方向分析：两个修复方案存在矛盾——方案A 修改 index.ts barrel 导出，" +
      "方案B 修改内部实现绕过 barrel。两者对 barrel 策略的处理方向不一致。" +
      "\n\n建议：统一走 barrel 导出，方案B 应改为通过 barrel 暴露新符号。"
    );
    const config: AgentFactoryConfig = {
      type: AgentType.Strategist,
      systemPrompt: "你是霜凝，Cortex StrategistAgent。监理修复方向一致性。",
      maxLoops: 3};
    const agent = createAgent(config, llm, toolkit);
    await agent.wakeup();
    scheduler.register(AgentType.Strategist, agent, "deepseek-reasoner");

    board.addNode({
      id: "task-direction-1",
      type: "strategist",
      tags: ["strategy" as const],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "检查 CodeAgent 和 ReviewAgent 的修复方向是否一致、有无矛盾。",
      results: [],
      createdAt: Date.now()});

    const report = await scheduler.executeAll();

    expect(report.completed).toBe(1);
    const node = board.getNode("task-direction-1")!;
    expect(node.results[0].success).toBe(true);
    expect(node.results[0].output).toContain("方向");
  });

  // ── 策略判断 ────────────────────────────────────

  it("霜凝接收 strategy 标签，返回修复优先序建议", async () => {
    const observer = new PipelineObserver();
    const board = new TaskBoard();
    const pool = new AgentPool();
    const toolkit = new Toolkit();

    const scheduler = new Scheduler(board, pool, observer);

    // 注册 AgentPool 配额
    pool.register({ type: AgentType.Strategist, maxInstances: 3 });

    const llm = mock.forAnalysis(
      "策略建议：\n1. P0 优先修复 barrel 导出缺失（影响外部引用）\n" +
      "2. P1 修复类型定义不一致（影响编译安全）\n" +
      "3. P2 优化测试覆盖率\n" +
      "以上顺序基于风险优先级：外部契约 > 类型安全 > 质量基线。"
    );
    const config: AgentFactoryConfig = {
      type: AgentType.Strategist,
      systemPrompt: "你是霜凝，Cortex StrategistAgent。提供修复优先序策略。",
      maxLoops: 3};
    const agent = createAgent(config, llm, toolkit);
    await agent.wakeup();
    scheduler.register(AgentType.Strategist, agent, "deepseek-reasoner");

    board.addNode({
      id: "task-strategy-1",
      type: "strategist",
      tags: ["strategy" as const],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "对当前发现的多个问题按风险优先级排序。",
      results: [],
      createdAt: Date.now()});

    const report = await scheduler.executeAll();

    expect(report.completed).toBe(1);
    const node = board.getNode("task-strategy-1")!;
    expect(node.results[0].success).toBe(true);
    expect(node.results[0].output).toContain("P0");
  });

  // ── 双标签 ──────────────────────────────────────

  it("霜凝同时接收 strategy + direction 标签，综合判断", async () => {
    const observer = new PipelineObserver();
    const board = new TaskBoard();
    const pool = new AgentPool();
    const toolkit = new Toolkit();

    const scheduler = new Scheduler(board, pool, observer);

    // 注册 AgentPool 配额
    pool.register({ type: AgentType.Strategist, maxInstances: 3 });

    const llm = mock.forAnalysis(
      "综合分析：\n" +
      "方向层面——两个 PR 修改方向一致，均增加 barrel 导出。\n" +
      "策略层面——建议在合并前独立验证新导出的类型签名，避免 barrel 污染。\n" +
      "优先级：P1（合并前加类型校验步骤）。"
    );
    const config: AgentFactoryConfig = {
      type: AgentType.Strategist,
      systemPrompt: "你是霜凝。综合方向监督与策略建议。",
      maxLoops: 3};
    const agent = createAgent(config, llm, toolkit);
    await agent.wakeup();
    scheduler.register(AgentType.Strategist, agent, "deepseek-reasoner");

    board.addNode({
      id: "task-combined-1",
      type: "strategist",
      tags: ["strategy" as const, "contract" as const],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "对修复方案进行方向和策略的双重审查。",
      results: [],
      createdAt: Date.now()});

    const report = await scheduler.executeAll();

    expect(report.completed).toBe(1);
    const node = board.getNode("task-combined-1")!;
    expect(node.results[0].success).toBe(true);
  });
});
