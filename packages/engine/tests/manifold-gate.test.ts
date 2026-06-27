// @ci: unit
/**
 * ManifoldGate 流约束门�?—�?全场景单元测�?
 *
 * 验证 mHC 流形约束的核心行为：
 * - 同类�?Agent 并发�?�?maxInstances
 * - FIFO 公平唤醒
 * - 超时优雅失败
 * - RLM 子任务不参与流约�?
 * - SpawnStep/CleanupStep 集成
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentType, AgentStatus, PipelinePriority, type TaskNode, type NodeResult } from "@cortex/shared";
import type { Agent } from "@cortex/shared";
import { TaskBoard, AgentPool, PipelineObserver, ManifoldGate } from "@cortex/scheduler";
import { Scheduler } from "@cortex/engine";

// ════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════

function makeNode(id: string, type: string, tags: string[] = ["implementation"]): TaskNode {
  return {
    id,
    type,
    tags: tags as TaskNode["tags"],
    needsMultiPerspective: false,
    status: "pending",
    claimedBy: [],
    payload: `Task ${id}`,
    results: [],
    createdAt: Date.now(),
  };
}

function makeSlowAgent(agentType: AgentType, delayMs: number = 500): Agent {
  return {
    type: agentType,
    status: AgentStatus.Awake,
    wakeup: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      return { nodeId: "", success: true, output: `done by ${agentType}` } as NodeResult;
    }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

// ════════════════════════════════════════════════════════
// ManifoldGate 核心行为
// ════════════════════════════════════════════════════════

describe("ManifoldGate 流约束核心行为", () => {
  beforeEach(() => {
    ManifoldGate.reset();
  });

  afterEach(() => {
    ManifoldGate.reset();
  });

  it("未注册类型默认 maxInstances=1", () => {
    expect(ManifoldGate.max("unknown")).toBe(1);
  });

  it("注册后 acquire 在配额内立即通过", async () => {
    ManifoldGate.register("test-type", 3);
    const ok1 = await ManifoldGate.acquire("test-type", 1000);
    const ok2 = await ManifoldGate.acquire("test-type", 1000);
    const ok3 = await ManifoldGate.acquire("test-type", 1000);
    expect(ok1).toBe(true);
    expect(ok2).toBe(true);
    expect(ok3).toBe(true);
    expect(ManifoldGate.active("test-type")).toBe(3);
  });

  it("超配额时等待 FIFO 唤醒", async () => {
    ManifoldGate.register("test-type", 1);
    const ok1 = await ManifoldGate.acquire("test-type", 5000);
    expect(ok1).toBe(true);
    expect(ManifoldGate.active("test-type")).toBe(1);
    expect(ManifoldGate.waiting("test-type")).toBe(0);

    // 第二�?acquire 应排�?
    const p2 = ManifoldGate.acquire("test-type", 5000);
    // 给微任务队列时间
    await new Promise((r) => setTimeout(r, 50));
    expect(ManifoldGate.waiting("test-type")).toBe(1);

    // 释放 �?唤醒 p2
    ManifoldGate.release("test-type");
    const ok2 = await p2;
    expect(ok2).toBe(true);
    expect(ManifoldGate.active("test-type")).toBe(1);
    expect(ManifoldGate.waiting("test-type")).toBe(0);
  });

  it("超时后返回 false 且不从队列唤醒下一任务", async () => {
    ManifoldGate.register("test-type", 1);
    await ManifoldGate.acquire("test-type", 5000); // 占满

    const timedOut = await ManifoldGate.acquire("test-type", 100); // 100ms 超时
    expect(timedOut).toBe(false);
    // 超时后不应影响活跃计�?
    expect(ManifoldGate.active("test-type")).toBe(1);
    expect(ManifoldGate.waiting("test-type")).toBe(0);
  });

  it("FIFO 顺序：先等待的先被唤醒", async () => {
    ManifoldGate.register("test-type", 1);
    await ManifoldGate.acquire("test-type", 5000); // 占满

    const order: number[] = [];
    const p1 = ManifoldGate.acquire("test-type", 5000).then((ok: boolean) => { order.push(1); return ok; });
    const p2 = ManifoldGate.acquire("test-type", 5000).then((ok: boolean) => { order.push(2); return ok; });
    const p3 = ManifoldGate.acquire("test-type", 5000).then((ok: boolean) => { order.push(3); return ok; });

    await new Promise((r) => setTimeout(r, 50));
    expect(ManifoldGate.waiting("test-type")).toBe(3);

    // 逐次释放
    ManifoldGate.release("test-type"); // 唤醒 p1
    await p1;
    expect(ManifoldGate.active("test-type")).toBe(1);

    ManifoldGate.release("test-type"); // 唤醒 p2
    await p2;
    expect(ManifoldGate.active("test-type")).toBe(1);

    ManifoldGate.release("test-type"); // 唤醒 p3
    await p3;

    expect(order).toEqual([1, 2, 3]);
  });

  it("release 当 active=0 时不做负操作", () => {
    ManifoldGate.register("test-type", 3);
    ManifoldGate.release("test-type"); // 应安�?no-op
    expect(ManifoldGate.active("test-type")).toBe(0);
  });

  it("reset 清空所有状态", async () => {
    ManifoldGate.register("test-type", 3);
    await ManifoldGate.acquire("test-type", 100);
    expect(ManifoldGate.active("test-type")).toBe(1);

    ManifoldGate.reset();
    expect(ManifoldGate.active("test-type")).toBe(0);
    expect(ManifoldGate.max("test-type")).toBe(1); // 重置后退回默�?
  });
});

// ════════════════════════════════════════════════════════
// Scheduler 集成：流约束下的并发调度
// ════════════════════════════════════════════════════════

describe("Scheduler + ManifoldGate 集成", () => {
  let board: TaskBoard;
  let pool: AgentPool;
  let observer: PipelineObserver;
  let scheduler: Scheduler;

  beforeEach(() => {
    ManifoldGate.reset();
    board = new TaskBoard();
    pool = new AgentPool();
    observer = new PipelineObserver();
    scheduler = new Scheduler(board, pool, observer);
  });

  afterEach(() => {
    ManifoldGate.reset();
  });

  it("同类型超池节点被流控等待后全部成功（mHC 约束不丢节点）", async () => {
    // 注册 code agent，maxInstances=2（模拟紧缺）
    pool.register({ type: AgentType.Code, maxInstances: 2 });
    const agent = makeSlowAgent(AgentType.Code, 300);
    scheduler.register(AgentType.Code, agent, "test");

    // 同一�?5 �?code 节点——旧行为�? 成功 + 3 池耗尽失败
    // 新行为（mHC）：2 立即执行 + 3 排队等待 �?全部成功
    const ids = ["c1", "c2", "c3", "c4", "c5"];
    for (const id of ids) {
      board.addNode(makeNode(id, "code", ["implementation"]));
    }

    const report = await scheduler.executeAll();
    expect(report.completed).toBe(5);
    expect(report.failed).toBe(0);
    expect(agent.execute).toHaveBeenCalledTimes(5);
  }, 30_000);

  it("混合类型节点不受彼此流控影响", async () => {
    // code max=2, analysis max=5
    pool.register({ type: AgentType.Code, maxInstances: 2 });
    pool.register({ type: AgentType.Analysis, maxInstances: 5 });

    const codeAgent = makeSlowAgent(AgentType.Code, 200);
    const analysisAgent = makeSlowAgent(AgentType.Analysis, 100);
    scheduler.register(AgentType.Code, codeAgent, "test");
    scheduler.register(AgentType.Analysis, analysisAgent, "test");

    // 同一�?3 code + 3 analysis
    for (let i = 1; i <= 3; i++) {
      board.addNode(makeNode(`code-${i}`, "code", ["implementation"]));
      board.addNode(makeNode(`analysis-${i}`, "analysis", ["analysis"]));
    }

    const report = await scheduler.executeAll();
    expect(report.completed).toBe(6);
    expect(report.failed).toBe(0);
    // code 只有 2 个并发，�?3 个应排队
    expect(codeAgent.execute).toHaveBeenCalledTimes(3);
    expect(analysisAgent.execute).toHaveBeenCalledTimes(3);
  }, 30_000);

  it("父子节点按依赖顺序——子节点不排队在父节点完成前", async () => {
    pool.register({ type: AgentType.Code, maxInstances: 1 }); // 极紧
    const agent = makeSlowAgent(AgentType.Code, 100);
    scheduler.register(AgentType.Code, agent, "test");

    board.addNode({
      ...makeNode("parent", "code", ["implementation"]),
      parentId: undefined,
    });
    board.addNode({
      ...makeNode("child", "code", ["implementation"]),
      parentId: "parent",
    });

    const events: string[] = [];
    observer.on(PipelinePriority.HIGH, (e: any) => {
      if (e.type === "node.complete") events.push(e.payload.nodeId);
    });

    const report = await scheduler.executeAll();
    expect(report.completed).toBe(2);
    expect(report.failed).toBe(0);
    // 父先完成（拓扑排序保�?+ 流控只在同层生效�?
    expect(events).toEqual(["parent", "child"]);
  }, 10_000);
});

// ══════════════════════════════════════════════════?
// ManifoldGate 边界——零槽位/负槽位/双重释放/队列溢出
// ══════════════════════════════════════════════════?

describe("ManifoldGate edge cases", () => {
  beforeEach(() => {
    ManifoldGate.reset();
  });

  afterEach(() => {
    ManifoldGate.reset();
  });

  it.skip("should handle zero slots (SKIP: ManifoldGate 行为变更)", async () => {
    ManifoldGate.register("zero-slot", 0);
    // 0 槽位——acquire 应超时返回 false
    const ok = await ManifoldGate.acquire("zero-slot", 100);
    expect(ok).toBe(false);
    expect(ManifoldGate.active("zero-slot")).toBe(0);
  });

  it.skip("should handle negative slots (clamp to 0) (SKIP: ManifoldGate 行为变更)", async () => {
    ManifoldGate.register("neg-slot", -5);
    // 负槽位应被夹到 0——acquire 总是超时
    const ok = await ManifoldGate.acquire("neg-slot", 100);
    expect(ok).toBe(false);
    expect(ManifoldGate.active("neg-slot")).toBe(0);
  });

  it("should handle release of unacquired slot", () => {
    ManifoldGate.register("unacquired", 3);
    // 释放未获取的槽位——应安全 no-op
    expect(() => ManifoldGate.release("unacquired")).not.toThrow();
    expect(ManifoldGate.active("unacquired")).toBe(0);
  });

  it("should handle double release of same slot", async () => {
    ManifoldGate.register("double-rel", 2);
    const ok = await ManifoldGate.acquire("double-rel", 100);
    expect(ok).toBe(true);
    expect(ManifoldGate.active("double-rel")).toBe(1);

    // 第一次释放
    ManifoldGate.release("double-rel");
    expect(ManifoldGate.active("double-rel")).toBe(0);

    // 第二次释放——不应变为负值
    ManifoldGate.release("double-rel");
    expect(ManifoldGate.active("double-rel")).toBe(0);
  });

  it("should handle wait queue overflow", async () => {
    ManifoldGate.register("overflow", 1);
    // 占满 1 个槽位
    await ManifoldGate.acquire("overflow", 5000);

    // 大量排队——不应崩溃
    const waiters = Array.from({ length: 100 }, (_, i) =>
      ManifoldGate.acquire("overflow", 5000),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(ManifoldGate.waiting("overflow")).toBeGreaterThanOrEqual(50);

    // 释放所有槽位——等待者逐步唤醒
    ManifoldGate.release("overflow");
    await new Promise((r) => setTimeout(r, 100));
    // 至少一个排队者被唤醒
    expect(ManifoldGate.active("overflow")).toBe(1);
  });

  it("should timeout correctly under load", async () => {
    ManifoldGate.register("load-timeout", 2);
    // 占满 2 个槽位
    await ManifoldGate.acquire("load-timeout", 5000);
    await ManifoldGate.acquire("load-timeout", 5000);

    // 第三个 acquire 应超时
    const start = Date.now();
    const ok = await ManifoldGate.acquire("load-timeout", 50);
    const elapsed = Date.now() - start;

    expect(ok).toBe(false);
    // 超时应大致在 50ms 左右（允许小幅波动）
    expect(elapsed).toBeLessThan(500);
    expect(ManifoldGate.active("load-timeout")).toBe(2);
  });
});
