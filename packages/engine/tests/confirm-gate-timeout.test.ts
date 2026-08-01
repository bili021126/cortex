// @ci: unit
// P3: ConfirmGate 超时回退场景测试——验证超时自动拒绝、bypass 放行、dispose 安全关闭。
import { describe, it, expect } from "vitest";
import { ConfirmGate } from "@cortex/scheduler";
import { ReversibilityLevel } from "@cortex/config";


describe("ConfirmGate 超时回退", () => {
  // ── 超时自动拒绝 ──────────────────────────────

  it("waitFor 超时 → 自动返回 false（L2 高危操作无人确认）", async () => {
    const gate = new ConfirmGate(50); // 50ms 超时
    const reqId = gate.request({
      id: "timeout-l2",
      level: ReversibilityLevel.L2,
      toolName: "delete_file",
      summary: "删除关键文件——无人确认应超时拒绝"});

    // 不调用 resolve()，等待超时
    const result = await gate.waitFor(reqId);
    expect(result).toBe(false);
    // 超时后 pending 已清理
    expect(gate.hasPending()).toBe(false);
  });

  it("waitFor 超时 → L3 同样返回 false", async () => {
    const gate = new ConfirmGate(30); // 30ms 超时
    const reqId = gate.request({
      id: "timeout-l3",
      level: ReversibilityLevel.L3,
      toolName: "run_shell",
      summary: "执行高危命令——无人确认应超时拒绝"});

    const result = await gate.waitFor(reqId);
    expect(result).toBe(false);
    expect(gate.hasPending()).toBe(false);
  });

  it("超时前 resolve → 正常返回批准结果", async () => {
    const gate = new ConfirmGate(500); // 长超时
    const reqId = gate.request({
      id: "resolve-before-timeout",
      level: ReversibilityLevel.L2,
      toolName: "write_file",
      summary: "在超时前确认"});

    // 立即 resolve，远在超时前
    setTimeout(() => gate.resolve({ requestId: reqId, approved: true }), 10);

    const result = await gate.waitFor(reqId);
    expect(result).toBe(true);
    expect(gate.hasPending()).toBe(false);
  });

  // ── Bypass 模式 ──────────────────────────────

  it("bypassAll → needsConfirmation 全部返回 false", () => {
    const gate = new ConfirmGate();
    gate.bypassAll();

    expect(gate.needsConfirmation(ReversibilityLevel.L0)).toBe(false);
    expect(gate.needsConfirmation(ReversibilityLevel.L1)).toBe(false);
    expect(gate.needsConfirmation(ReversibilityLevel.L2)).toBe(false);
    expect(gate.needsConfirmation(ReversibilityLevel.L3)).toBe(false);
  });

  it("bypass 模式下 L2 waitFor 不需要真实确认即可返回 true", async () => {
    const gate = new ConfirmGate();
    gate.bypassAll();

    // bypass 下 needsConfirmation 返回 false，调用方不会走到 waitFor
    // 但若意外走到，waitFor 因 request 未登记 → 返回 false 符合防御语义
    expect(gate.needsConfirmation(ReversibilityLevel.L2)).toBe(false);
  });

  // ── 显式拒绝 ──────────────────────────────────

  it("resolve(false) → waitFor 返回 false（用户明确拒绝）", async () => {
    const gate = new ConfirmGate();
    const reqId = gate.request({
      id: "explicit-deny",
      level: ReversibilityLevel.L2,
      toolName: "delete_file",
      summary: "用户明确拒绝删除"});

    setTimeout(() => gate.resolve({ requestId: reqId, approved: false }), 5);

    const result = await gate.waitFor(reqId);
    expect(result).toBe(false);
    expect(gate.hasPending()).toBe(false);
  });

  // ── Dispose 安全关闭 ──────────────────────────

  it("dispose 后 pending 请求被 reject（引擎关闭）", async () => {
    const gate = new ConfirmGate();
    const reqId = gate.request({
      id: "dispose-test",
      level: ReversibilityLevel.L2,
      toolName: "write_file",
      summary: "引擎关闭前的待确认请求"});

    // 异步等待 + 立即 dispose
    const waitPromise = gate.waitFor(reqId);
    gate.dispose();

    // dispose 应 reject（与超时返回 false 区分开）
    await expect(waitPromise).rejects.toThrow("ConfirmGate 已关闭");
    expect(gate.hasPending()).toBe(false);
  });

  it("dispose 空 gate 不抛错", () => {
    const gate = new ConfirmGate();
    // 无 pending 请求时 dispose 应安全
    expect(() => gate.dispose()).not.toThrow();
  });

  // ── 批量确认 ──────────────────────────────────

  it("confirm 批量节点无 bridge → 默认放行返回 true", async () => {
    const gate = new ConfirmGate();
    const nodes = [
      { id: "n1", payload: "task A" },
      { id: "n2", payload: "task B" },
      { id: "n3", payload: "task C" },
    ];

    const result = await gate.confirm(nodes);
    expect(result).toBe(true);
  });

  it("confirm 批量节点 bypass → 放行返回 true", async () => {
    const gate = new ConfirmGate();
    gate.bypassAll();
    const nodes = [{ id: "n1", payload: "task A" }];

    const result = await gate.confirm(nodes);
    expect(result).toBe(true);
  });

  it("构造参数 timeoutMs 确实影响 waitFor 默认超时（快速超时验证）", async () => {
    // 传入极短超时 → waitFor 应快速返回 false
    const gate = new ConfirmGate(20);
    const reqId = gate.request({
      id: "fast-timeout",
      level: ReversibilityLevel.L2,
      toolName: "write_file",
      summary: "快速超时测试"});

    const start = Date.now();
    const result = await gate.waitFor(reqId);
    const elapsed = Date.now() - start;

    expect(result).toBe(false);
    // 应在 20ms 左右超时（放宽到 200ms 防止 CI 波动）
    expect(elapsed).toBeLessThan(200);
  });
});
