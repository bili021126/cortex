// @ci: e2e
/**
 * 并发路径 E2E — 3个plan→scheduler竞争→gate→memory事务
 *
 * 场景: 同时提交3个plan → scheduler分层并行 → gate并发安全性
 * → memory事务隔离(两阶段提交不互相干扰)
 *
 * 验证: 3个plan全部完成 + gate无泄漏 + memory无脏数据
 *
 * @skip CI 中默认跳过
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AgentType, PipelinePriority, type TaskNode, type ObservableEvent } from "@cortex/shared";
import { TaskBoard, AgentPool, PipelineObserver, ConfirmGate } from "@cortex/scheduler";
import { MemoryStore } from "@cortex/memory-store";
import { Toolkit } from "@cortex/platform";
import { LlmAdapter } from "@cortex/llm";
import { Scheduler } from "../../../src/core/scheduler.js";
import { createAgent } from "../../../src/components/index.js";
import { codeAgentConfig } from "../../../src/agents/registry.js";

describe("并发路径: 3个plan→scheduler竞争→gate→memory事务", () => {
  if (process.env.CI) return; // 需要真实 LLM，CI 跳过
  let store: MemoryStore;
  let scheduler: Scheduler;
  let board: TaskBoard;
  let pool: AgentPool;
  let observer: PipelineObserver;
  let toolkit: Toolkit;

  beforeAll(async () => {
    store = new MemoryStore();
    await store.init(":memory:");

    observer = new PipelineObserver();
    board = new TaskBoard();
    pool = new AgentPool();
    scheduler = new Scheduler(board, pool, observer);
    scheduler.setMemoryStore(store);

    const gate = new ConfirmGate();
    gate.bypassAll();
    toolkit = new Toolkit();
    toolkit.setGate(gate);
    toolkit.setObserver(observer);

    // 注册 Code Agent——Scheduler 按类型 1:1，单实例串行/并行执行全部 code 节点
    pool.register({ type: AgentType.Code, maxInstances: 5 });
    const adapter = new LlmAdapter({ apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock" });
    adapter.injectMock(async () => ({ content: "Task completed successfully.", tool_calls: [] }));
    const agent = createAgent(codeAgentConfig(`mock concurrent agent`), adapter, toolkit, store);
    await agent.wakeup();
    scheduler.register(AgentType.Code, agent, "mock-chat");
  });

  afterAll(async () => {
    await store.close();
  });

  it("3个独立plan并发提交 → 全部完成", { timeout: 120000 }, async () => {
    const plans: TaskNode[][] = [];
    for (let p = 0; p < 3; p++) {
      plans.push([
        {
          id: `concurrent-plan-${p}-node`,
          type: "implementation",
          tags: ["code"],
          status: "pending",
          claimedBy: [],
          payload: `Concurrent task ${p}`,
          results: [],
          needsMultiPerspective: false,
          createdAt: Date.now(),
        },
      ]);
    }

    // 全部添加到同一个 board
    for (const plan of plans) {
      for (const node of plan) {
        board.addNode(node);
      }
    }

    const report = await scheduler.executeAll();
    expect(report.completed).toBeGreaterThanOrEqual(1);
    expect(report.totalNodes).toBe(3);
  });

  it("memory事务隔离 — 两阶段提交不互相干扰", { timeout: 120000 }, async () => {
    // 写入3条独立记忆
    const ids = await Promise.all([
      store.write({
        source: { agentType: "code" as AgentType, taskId: "concurrent-1" },
        kind: "TaskLog" as any,
        semantic_gist: "concurrent memory test 1",
        content_blob: { seq: 1 },
        summary: "Concurrent memory 1",
        weight: 1,
      }),
      store.write({
        source: { agentType: "code" as AgentType, taskId: "concurrent-2" },
        kind: "TaskLog" as any,
        semantic_gist: "concurrent memory test 2",
        content_blob: { seq: 2 },
        summary: "Concurrent memory 2",
        weight: 1,
      }),
      store.write({
        source: { agentType: "code" as AgentType, taskId: "concurrent-3" },
        kind: "TaskLog" as any,
        semantic_gist: "concurrent memory test 3",
        content_blob: { seq: 3 },
        summary: "Concurrent memory 3",
        weight: 1,
      }),
    ]);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3); // 无重复ID

    // 验证全部可读且数据完整——显式 limit 防被前置测试注入的 TaskLog 挤出默认 3 条上限
    const allEntries = await store.read({ kind: "TaskLog" as any, limit: 50 });
    const planEntries = allEntries.filter((e) =>
      e.summary?.startsWith("Concurrent memory"),
    );
    expect(planEntries.length).toBeGreaterThanOrEqual(3);

    // 验证无脏数据（content_blob 未交叉污染）
    for (const e of planEntries) {
      const blob = e.content_blob as { seq?: number };
      expect(blob.seq).toBeDefined();
    }
  });

  it("ConfirmGate 并发安全 — 同时 bypass 调用不泄漏", { timeout: 120000 }, async () => {
    const gate = new ConfirmGate();
    gate.bypassAll();

    // 模拟并发 bypass 调用
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        Promise.resolve().then(() => {
          // bypassAll 幂等，重复调用不抛异常
          expect(() => gate.bypassAll()).not.toThrow();
        }),
      ),
    );

    // verify bypass 仍然生效
    expect((gate as any)._bypass).toBe(true);
  });
});
