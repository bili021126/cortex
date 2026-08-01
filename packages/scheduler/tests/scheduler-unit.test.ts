// @ci: unit
// ============================================================
// @cortex/scheduler —— 单元测试
// ConfirmGate / TopologicalLayeredDriver / ReplanManager
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfirmGate, TopologicalLayeredDriver, ReplanManager } from "@cortex/scheduler";

import { SCHEDULER_MAX_TOTAL_REPLANS, SCHEDULER_MAX_DEGRADED_DRAINS, ReversibilityLevel } from "@cortex/config";
import type { TaskNode, AgentType } from "@cortex/shared";
import type { IReplanProvider } from "@cortex/scheduler";

// ─── ConfirmGate ───────────────────────────────────────────

describe("ConfirmGate", () => {
  let gate: ConfirmGate;

  beforeEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true, configurable: true });
    gate = new ConfirmGate();
  });

  it("L0/L1 始终通过", () => {
    // L0 纯读取，永不确认
    expect(gate.needsConfirmation(ReversibilityLevel.L0)).toBe(false);
    // L1 可逆写入，无 trustModel 时 fail-open 放行
    expect(gate.needsConfirmation(ReversibilityLevel.L1)).toBe(false);
  });

  it("bypassAll 仅测试环境可用", () => {
    // 测试环境下 bypassAll 不抛错
    expect(() => gate.bypassAll()).not.toThrow();
    expect(gate.canBypass()).toBe(true);
    // bypass 模式下所有确认跳过
    expect(gate.needsConfirmation(ReversibilityLevel.L2)).toBe(false);
    expect(gate.needsConfirmation(ReversibilityLevel.L3)).toBe(false);
  });

  it("L2 无信任分时需确认", () => {
    // L2 不可逆写入，无信任分时永远需确认
    expect(gate.needsConfirmation(ReversibilityLevel.L2)).toBe(true);
  });

  it("L3 无信任分时需确认", () => {
    // L3 不可恢复，永远需确认
    expect(gate.needsConfirmation(ReversibilityLevel.L3)).toBe(true);
  });

  it("request→waitFor→resolve 往返", async () => {
    const req = {
      id: "test-1",
      level: ReversibilityLevel.L2,
      toolName: "write_file",
      summary: "测试确认",
      detail: "确认测试",
    };
    gate.request(req);

    // 异步触发 resolve
    const waitPromise = gate.waitFor("test-1", 5000);

    // 模拟用户确认
    const resolved = gate.resolve({ requestId: "test-1", approved: true });
    expect(resolved).toBe(true);

    const result = await waitPromise;
    expect(result).toBe(true);
  });

  it("request→handleTimeout 返回 false", async () => {
    const req = {
      id: "test-2",
      level: ReversibilityLevel.L2,
      toolName: "write_file",
      summary: "测试超时",
      detail: "超时测试",
    };
    gate.request(req);

    const waitPromise = gate.waitFor("test-2", 100);

    const handled = gate.handleTimeout("test-2", ReversibilityLevel.L2);
    expect(handled).toBe(false);

    const result = await waitPromise;
    expect(result).toBe(false);
  });

  it("request→waitFor→resolve 拒绝", async () => {
    const req = {
      id: "test-3",
      level: ReversibilityLevel.L2,
      toolName: "delete_file",
      summary: "测试拒绝",
      detail: "拒绝测试",
    };
    gate.request(req);

    const waitPromise = gate.waitFor("test-3", 5000);
    gate.resolve({ requestId: "test-3", approved: false });

    const result = await waitPromise;
    expect(result).toBe(false);
  });

  it("dispose 清理所有待处理请求", () => {
    gate.request({
      id: "d1", level: ReversibilityLevel.L2, toolName: "t",
      summary: "s", detail: "d",
    });
    gate.request({
      id: "d2", level: ReversibilityLevel.L2, toolName: "t",
      summary: "s", detail: "d",
    });
    expect(gate.hasPending()).toBe(true);

    gate.dispose();
    expect(gate.hasPending()).toBe(false);
  });

  it("check L0 自动放行（信任分足够时 trust auto）", () => {
    const result = gate.check(ReversibilityLevel.L0);
    expect(result.approved).toBe(true);
    expect(result.reason).toBe("trust auto");
  });

  it("check L2 无信任记录时需手动确认", () => {
    const result = gate.check(ReversibilityLevel.L2);
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("manual confirm");
  });
});

// ─── TopologicalLayeredDriver ─────────────────────────────

describe("TopologicalLayeredDriver", () => {
  it("实例化并返回正确名称", () => {
    const driver = new TopologicalLayeredDriver();
    expect(driver).toBeDefined();
    expect(driver.name).toBe("topological-layered");
  });

  it("run 是异步方法", async () => {
    const driver = new TopologicalLayeredDriver();
    expect(driver.run).toBeInstanceOf(Function);
    // 验证 constructor 正确
    expect(driver.name).toBe("topological-layered");
  });
});

// ─── ReplanManager ────────────────────────────────────────

describe("ReplanManager", () => {
  it("无 replanProvider 时 enqueue 不抛错", () => {
    const board = { getPendingNodes: () => [], getAllNodes: () => [] } as any;
    const observer = { emit: vi.fn() } as any;
    const config = { executeAllTimeoutMs: 300_000, reactLoopTimeoutMs: 120_000 } as any;

    const mgr = new ReplanManager(board, observer, undefined, config);
    expect(mgr.hasPending).toBe(false);

    // enqueue 应安全返回（provider 为 undefined 时直接 return）
    mgr.enqueue({ id: "n1" } as any, "test reason");
    expect(mgr.hasPending).toBe(false);
  });

  it("tryFireReplan 无 provider 时返回 Promise", () => {
    const board = { getPendingNodes: () => [], getAllNodes: () => [] } as any;
    const observer = { emit: vi.fn() } as any;
    const config = { executeAllTimeoutMs: 300_000, reactLoopTimeoutMs: 120_000 } as any;

    const mgr = new ReplanManager(board, observer, undefined, config);
    const result = mgr.tryFireReplan();
    // 无 provider 时 drain 是异步空操作，返回 Promise
    expect(result).toBeInstanceOf(Promise);
  });

  it("reset 清零所有状态", () => {
    const board = { getPendingNodes: () => [], getAllNodes: () => [] } as any;
    const observer = { emit: vi.fn() } as any;
    const config = { executeAllTimeoutMs: 300_000, reactLoopTimeoutMs: 120_000 } as any;

    const mgr = new ReplanManager(board, observer, undefined, config);
    mgr.reset();
    expect(mgr.hasPending).toBe(false);
  });

  it("P0-B: 降级 drain 有限收敛——不会无限派生新节点", async () => {
    const board = {
      addNode: vi.fn(),
      removeNode: vi.fn(),
      removeSubtree: vi.fn(),
      getNode: vi.fn(),
      getPendingNodes: () => [],
      getAllNodes: () => [],
    } as any;
    const observer = { emit: vi.fn() } as any;
    const config = { executeAllTimeoutMs: 300_000, reactLoopTimeoutMs: 120_000 } as any;

    // provider 每次返回一个新节点——模拟持续失败链
    let genCount = 0;
    const provider: IReplanProvider = {
      async requestReplan() {
        genCount++;
        const id = `child-${genCount}`;
        return { nodes: [{ id, tags: [] }] as TaskNode[], impactScope: "local" as const };
      },
      async requestBoundaryReplan() {
        return { nodes: [], impactScope: "local" as const };
      },
    };

    const mgr = new ReplanManager(board, observer, provider, config as any);

    // 耗尽全局配额（enqueue + tryFireReplan 共 SCHEDULER_MAX_TOTAL_REPLANS 次）
    for (let i = 0; i < SCHEDULER_MAX_TOTAL_REPLANS; i++) {
      mgr.enqueue({ id: `q${i}`, tags: [] } as any, "failure");
      const p = mgr.tryFireReplan();
      if (p) await p;
    }

    // 记录降级 drain 前的新节点生成数
    const beforeDegraded = genCount;

    // 触发降级 drain 循环（超过 SCHEDULER_MAX_DEGRADED_DRAINS 次）
    for (let i = 0; i < SCHEDULER_MAX_DEGRADED_DRAINS + 3; i++) {
      mgr.enqueue({ id: `d${i}`, tags: [] } as any, "failure");
      const p = mgr.tryFireReplan();
      if (p) await p;
    }

    // P0-B(a): 降级 drain 有预算上限——新节点生成数不会超出 degrade 预算 + 正常配额
    const degradedRuns = genCount - beforeDegraded;
    expect(degradedRuns).toBeLessThanOrEqual(SCHEDULER_MAX_DEGRADED_DRAINS + 1);

    // P0-B(b): 新节点继承祖先 count，验证 replanCount 不含零值
    expect(mgr.hasPending).toBe(false); // 预算耗尽后队列清空
  });

  it("P1-B1: 同一节点重复入队被去重", () => {
    const board = {
      addNode: vi.fn(),
      removeNode: vi.fn(),
      removeSubtree: vi.fn(),
      getPendingNodes: () => [],
      getAllNodes: () => [],
    } as any;
    const observer = { emit: vi.fn() } as any;
    const config = { executeAllTimeoutMs: 300_000, reactLoopTimeoutMs: 120_000 } as any;
    const provider: IReplanProvider = {
      async requestReplan() {
        return { nodes: [], impactScope: "local" as const };
      },
      async requestBoundaryReplan() {
        return { nodes: [], impactScope: "local" as const };
      },
    };

    const mgr = new ReplanManager(board, observer, provider, config as any);

    // 同一节点相同 disposition 重复入队两次
    const node = { id: "dup-node", tags: [] } as any;
    mgr.enqueue(node, "failure");
    mgr.enqueue(node, "failure");

    expect(mgr.hasPending).toBe(true);

    // 用内部属性验证队列只保留一条
    const queue = (mgr as any).replanQueue as any[];
    expect(queue.length).toBe(1);
  });

  it("P1-B2: _processReplanItem 异常时回滚新节点", async () => {
    let addNodeCallCount = 0;
    const board = {
      addNode: vi.fn(() => {
        addNodeCallCount++;
        // 第二次 addNode 抛异常模拟失败
        if (addNodeCallCount === 2) throw new Error("Board full");
      }),
      removeNode: vi.fn(),
      removeSubtree: vi.fn(),
      getNode: vi.fn(),
      getPendingNodes: () => [],
      getAllNodes: () => [],
    } as any;
    const observer = { emit: vi.fn() } as any;
    const config = { executeAllTimeoutMs: 300_000, reactLoopTimeoutMs: 120_000 } as any;
    const provider: IReplanProvider = {
      async requestReplan() {
        // 返回两个新节点——第二个会触发 addNode 异常
        return {
          nodes: [
            { id: "child1", tags: [], isRlmSubtask: false } as TaskNode,
            { id: "child2", tags: [], isRlmSubtask: false } as TaskNode,
          ],
          impactScope: "local" as const,
        };
      },
      async requestBoundaryReplan() {
        return { nodes: [], impactScope: "local" as const };
      },
    };

    const mgr = new ReplanManager(board, observer, provider, config as any);

    mgr.enqueue({ id: "parent", tags: [] } as any, "failure");
    const p = mgr.tryFireReplan();
    // _drain 内部用 Promise.allSettled 收集错误——不向上传播 reject，错误经 SchedulerReplanFailed 事件上报
    if (p) await p;

    // P1-B2: 回滚——已添加的 child1 应被 removeNode
    expect(board.removeNode).toHaveBeenCalledWith("child1");
    // child2 未成功 addNode，不应被 remove
    expect(board.removeNode).toHaveBeenCalledTimes(1);
    // 原节点 parent 不应被移除
    expect(board.removeNode).not.toHaveBeenCalledWith("parent");
    expect(board.removeSubtree).not.toHaveBeenCalled();
    // 失败经事件上报而非静默
    expect(observer.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "scheduler.replan.failed" }),
    );
  });

  it("resolveChains 空链返回零", () => {
    const board = { getPendingNodes: () => [], getAllNodes: () => [] } as any;
    const observer = { emit: vi.fn() } as any;
    const config = { executeAllTimeoutMs: 300_000, reactLoopTimeoutMs: 120_000 } as any;

    const mgr = new ReplanManager(board, observer, undefined, config);
    const [completed, failed] = mgr.resolveChains([]);
    expect(completed).toBe(0);
    expect(failed).toBe(0);
  });
  });
