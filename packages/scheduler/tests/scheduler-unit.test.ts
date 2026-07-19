// @ci: unit
// ============================================================
// @cortex/scheduler —— 单元测试
// ConfirmGate / TopologicalLayeredDriver / ReplanManager
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfirmGate, TopologicalLayeredDriver, ReplanManager } from "@cortex/scheduler";
import { ReversibilityLevel } from "@cortex/shared";
import { SCHEDULER_MAX_TOTAL_REPLANS } from "@cortex/config";

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
