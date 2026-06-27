// @ci: unit
/**
 * engine-bridge-integration.test.ts — engine↔cli EngineBridge 集成测试
 *
 * 覆盖轻量模式生命周期、rebootstrap 语义（错误路径验证）、
 * shutdown 边界、LLM 未配置时的错误路径。
 *
 * 轻量模式不需要 API key——EngineBridge.ensureInitialized()。
 * Bootstrap 依赖引擎全量环境（含 cortex-agents.json / plugins），
 * 此处验证其前置条件检查，而非完整加载。
 */
import { describe, it, expect } from "vitest";
import { EngineBridge, ConfigManager } from "@cortex/cli";
import type { BridgeContext } from "@cortex/cli";

// ── 辅助 ─────────────────────────────────────

function createBridge(): { bridge: EngineBridge; config: ConfigManager } {
  const config = new ConfigManager();
  const bridge = new EngineBridge(config);
  return { bridge, config };
}

// ═══════════════════════════════════════════
// 模式切换（轻量模式 + bootstrap 前置条件）
// ═══════════════════════════════════════════

describe("EngineBridge 模式切换", () => {
  it("should initialize in lightweight mode (no API key needed)", async () => {
    const { bridge } = createBridge();

    const lwCtx = await bridge.ensureInitialized();
    expect(lwCtx.initialized).toBe(true);
    expect(lwCtx.bootstrapped).toBeUndefined();
    expect(lwCtx.scheduler).toBeDefined();
    expect(lwCtx.memoryStore).toBeDefined();
    expect(bridge.ready).toBe(true);
    expect(bridge.bootstrapped).toBe(false);
  });

  it("should throw before bootstrap without setBootstrapConfig", async () => {
    const { bridge } = createBridge();

    // 未调用 setBootstrapConfig 时 ensureBootstrapped 应抛可预期错误
    await expect(bridge.ensureBootstrapped()).rejects.toThrow(
      /setBootstrapConfig/,
    );
  });

  it("should report correct state after init → shutdown → re-init", async () => {
    const { bridge } = createBridge();

    expect(bridge.isInitialized).toBe(false);
    expect(bridge.ready).toBe(false);

    await bridge.ensureReady();
    expect(bridge.isInitialized).toBe(true);

    await bridge.shutdown();
    expect(bridge.isInitialized).toBe(false);

    // 再次初始化
    await bridge.ensureReady();
    expect(bridge.isInitialized).toBe(true);
  });

  it("should handle getScheduler/getMemoryStore/getTaskBoard after init", async () => {
    const { bridge } = createBridge();
    await bridge.ensureReady();

    await expect(bridge.getScheduler()).resolves.toBeDefined();
    await expect(bridge.getMemoryStore()).resolves.toBeDefined();
    await expect(bridge.getTaskBoard()).resolves.toBeDefined();
  });
});

// ═══════════════════════════════════════════
// 异常恢复
// ═══════════════════════════════════════════

describe("EngineBridge 异常恢复", () => {
  it("should handle shutdown before initialization gracefully", async () => {
    const { bridge } = createBridge();
    await expect(bridge.shutdown()).resolves.not.toThrow();
    await expect(bridge.shutdown()).resolves.not.toThrow();
  });

  it("should handle double shutdown gracefully", async () => {
    const { bridge } = createBridge();
    await bridge.ensureReady();
    await expect(bridge.shutdown()).resolves.not.toThrow();
    await expect(bridge.shutdown()).resolves.not.toThrow();
  });

  it("should handle submitTask after shutdown gracefully", async () => {
    const { bridge } = createBridge();
    await bridge.ensureReady();
    await bridge.shutdown();

    // shutdown 后 submitTask——内部会惰性重建 ctx
    await expect(
      bridge.submitTask({
        id: "post-shutdown-task",
        type: "implementation",
        tags: ["test"],
        needsMultiPerspective: false,
        status: "pending",
        claimedBy: [],
        payload: "after shutdown",
        results: [],
        createdAt: Date.now(),
      }),
    ).resolves.not.toThrow();
  });

  it("should handle executeAll with empty task board", async () => {
    const { bridge } = createBridge();
    await bridge.ensureReady();
    const report = await bridge.executeAll();
    expect(report).toBeDefined();
    expect(report.totalNodes).toBe(0);
    expect(report.completed).toBe(0);
  });
});

// ═══════════════════════════════════════════
// LLM 未配置
// ═══════════════════════════════════════════

describe("EngineBridge LLM 未配置", () => {
  it("should throw from directChat before LLM configured", async () => {
    const { bridge } = createBridge();
    await expect(
      bridge.directChat("system prompt", [{ role: "user", content: "hello" }]),
    ).rejects.toThrow(/LLM/);
  });

  it("should throw from streamChat before LLM configured", async () => {
    const { bridge } = createBridge();
    await expect(
      bridge.streamChat("model", [], undefined, () => {}),
    ).rejects.toThrow(/LLM/);
  });

  it("should return empty tool defs before Toolkit injected", async () => {
    const { bridge } = createBridge();
    await bridge.ensureReady();
    const defs = bridge.getToolDefs("code" as any);
    expect(defs).toEqual([]);
  });
});
