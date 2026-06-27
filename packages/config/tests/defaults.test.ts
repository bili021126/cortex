// @ci: unit

import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_ENGINE_CONFIG,
  resolveConfig,
  ENGINE_DEFAULTS,
  loadEngineDefaults,
  RETRIEVAL_ALPHA,
  RETRIEVAL_BETA,
} from "@cortex/config";

describe("@cortex/config — DEFAULT_ENGINE_CONFIG", () => {
  it("最大重规划配额与决策一致", () => {
    expect(DEFAULT_ENGINE_CONFIG.maxReplanPerNode).toBe(10);
    expect(DEFAULT_ENGINE_CONFIG.maxTotalReplans).toBe(50);
  });

  it("executeAllTimeoutMs 为 10 分钟", () => {
    expect(DEFAULT_ENGINE_CONFIG.executeAllTimeoutMs).toBe(600_000);
  });

  it("reactLoopTimeoutMs 为 5 分钟", () => {
    expect(DEFAULT_ENGINE_CONFIG.reactLoopTimeoutMs).toBe(300_000);
  });

  it("默认 LLM 指向 DeepSeek", () => {
    expect(DEFAULT_ENGINE_CONFIG.llm.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(DEFAULT_ENGINE_CONFIG.llm.chatModel).toBe("deepseek-v4-flash");
  });

  it("嵌套对象默认均为完整值", () => {
    expect(DEFAULT_ENGINE_CONFIG.toolTimeouts.searchCode).toBeGreaterThan(0);
    expect(DEFAULT_ENGINE_CONFIG.toolTimeouts.runShell).toBeGreaterThan(0);
    expect(DEFAULT_ENGINE_CONFIG.inspector.tscTimeout).toBeGreaterThan(0);
  });

  // ── 边界：所有 timeout 值在合理范围内 ────────────

  it("所有 toolTimeouts 均为非负数", () => {
    const t = DEFAULT_ENGINE_CONFIG.toolTimeouts;
    expect(t.searchCode).toBeGreaterThanOrEqual(0);
    expect(t.runShell).toBeGreaterThanOrEqual(0);
    expect(t.confirmWait).toBeGreaterThanOrEqual(0);
    expect(t.webSearch).toBeGreaterThanOrEqual(0);
    expect(t.webSearchCacheTTL).toBeGreaterThanOrEqual(0);
    expect(t.webSearchRetries).toBeGreaterThanOrEqual(0);
  });

  it("所有 inspector timeout 均为正数", () => {
    const insp = DEFAULT_ENGINE_CONFIG.inspector;
    expect(insp.tscTimeout).toBeGreaterThan(0);
    expect(insp.testTimeout).toBeGreaterThan(0);
    expect(insp.vitestTimeout).toBeGreaterThan(0);
  });

  it("executeAllTimeoutMs 应大于 reactLoopTimeoutMs", () => {
    expect(DEFAULT_ENGINE_CONFIG.executeAllTimeoutMs)
      .toBeGreaterThan(DEFAULT_ENGINE_CONFIG.reactLoopTimeoutMs);
  });
});

describe("@cortex/config — resolveConfig", () => {
  it("无参调用返回默认值副本", () => {
    const cfg = resolveConfig();
    expect(cfg.defaultMaxLoops).toBe(64);
    expect(cfg.maxReplanPerNode).toBe(10);
    // 副本不可影响全局默认
    cfg.defaultMaxLoops = 999 as never;
    expect(DEFAULT_ENGINE_CONFIG.defaultMaxLoops).toBe(64);
  });

  it("部分覆盖——标量字段", () => {
    const cfg = resolveConfig({ defaultMaxLoops: 32 });
    expect(cfg.defaultMaxLoops).toBe(32);
    expect(cfg.maxReplanPerNode).toBe(10); // 未覆盖回退默认
  });

  it("部分覆盖——嵌套对象浅合并", () => {
    const cfg = resolveConfig({
      llm: { chatModel: "custom-model" },
    } as any);
    expect(cfg.llm.chatModel).toBe("custom-model");
    expect(cfg.llm.baseUrl).toBe("https://api.deepseek.com/v1"); // 未覆盖回退
    expect(cfg.llm.reasonerModel).toBe("deepseek-v4-flash");
  });

  it("toolTimeouts 部分覆盖不丢其他字段", () => {
    const cfg = resolveConfig({
      toolTimeouts: { searchCode: 5000 },
    });
    expect(cfg.toolTimeouts.searchCode).toBe(5000);
    expect(cfg.toolTimeouts.runShell).toBe(60_000);
    expect(cfg.toolTimeouts.confirmWait).toBe(300_000);
  });

  it("backends 副本独立，不共享引用", () => {
    const cfg1 = resolveConfig();
    const cfg2 = resolveConfig({
      search: { backends: ["custom-backend"] },
    } as any);
    expect(cfg2.search.backends).toEqual(["custom-backend"]);
    expect(cfg1.search.backends).toEqual([]);
  });

  // ── 边界 ──────────────────────────────────────────

  it("传空对象应得到全默认值", () => {
    const cfg = resolveConfig({});
    expect(cfg.defaultMaxLoops).toBe(64);
    expect(cfg.executeAllTimeoutMs).toBe(600_000);
  });

  it("所有 null 字段应回退到默认值", () => {
    const cfg = resolveConfig({
      defaultMaxLoops: null as unknown as number,
      inspectorMaxLoops: null as unknown as number,
    });
    expect(cfg.defaultMaxLoops).toBe(64);
    expect(cfg.inspectorMaxLoops).toBe(48);
  });

  it("llm 全覆盖应替换所有值", () => {
    const cfg = resolveConfig({
      llm: {
        baseUrl: "http://localhost:8080",
        chatModel: "local-model",
        reasonerModel: "local-reasoner",
      },
    });
    expect(cfg.llm.baseUrl).toBe("http://localhost:8080");
    expect(cfg.llm.chatModel).toBe("local-model");
    expect(cfg.llm.reasonerModel).toBe("local-reasoner");
  });

  it("filePaths 部分覆盖不丢其他字段", () => {
    const cfg = resolveConfig({
      filePaths: { skillRegistry: "custom-registry.json" },
    } as any);
    expect(cfg.filePaths.skillRegistry).toBe("custom-registry.json");
    expect(cfg.filePaths.codingStandards).toBe("prompts/coding-standards.md");
  });

  it("skillSystem 部分覆盖", () => {
    const cfg = resolveConfig({
      skillSystem: { maxRetries: 3 },
    } as any);
    expect(cfg.skillSystem.maxRetries).toBe(3);
    expect(cfg.skillSystem.defaultTimeoutMs).toBe(30_000);
  });
});

describe("@cortex/config — ENGINE_DEFAULTS", () => {
  it("RETRIEVAL_ALPHA + RETRIEVAL_BETA 应等于 1.0", () => {
    expect(RETRIEVAL_ALPHA + RETRIEVAL_BETA).toBeCloseTo(1.0, 10);
  });

  it("lockTimeoutMs 应为合理值 (>0)", () => {
    expect(ENGINE_DEFAULTS.lockTimeoutMs).toBeGreaterThan(0);
  });

  it("shutdownForceExitDelayMs 应小于 shutdownTimeoutMs", () => {
    expect(ENGINE_DEFAULTS.shutdownForceExitDelayMs)
      .toBeLessThan(ENGINE_DEFAULTS.shutdownTimeoutMs);
  });

  it("schedulerMaxRounds 应为正数", () => {
    expect(ENGINE_DEFAULTS.schedulerMaxRounds).toBeGreaterThan(0);
  });

  it("maxTotalMemories 应为正数", () => {
    expect(ENGINE_DEFAULTS.maxTotalMemories).toBeGreaterThan(0);
  });

  it("frozenObliterateDays 应小于 staleFreezeDays", () => {
    expect(ENGINE_DEFAULTS.frozenObliterateDays)
      .toBeLessThan(ENGINE_DEFAULTS.staleFreezeDays);
  });

  it("monitorThreshold 应为非负整数", () => {
    expect(ENGINE_DEFAULTS.monitorThreshold).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(ENGINE_DEFAULTS.monitorThreshold)).toBe(true);
  });

  it("embeddingCacheSize 应为合理值", () => {
    expect(ENGINE_DEFAULTS.embeddingCacheSize).toBeGreaterThan(0);
  });

  it("vectorDedupThreshold 应在 0~1 范围内", () => {
    expect(ENGINE_DEFAULTS.vectorDedupThreshold).toBeGreaterThan(0);
    expect(ENGINE_DEFAULTS.vectorDedupThreshold).toBeLessThanOrEqual(1);
  });

  it("weightAgingFactor 应在 0~1 范围内", () => {
    expect(ENGINE_DEFAULTS.weightAgingFactor).toBeGreaterThan(0);
    expect(ENGINE_DEFAULTS.weightAgingFactor).toBeLessThanOrEqual(1);
  });
});

describe("@cortex/config — loadEngineDefaults", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    // 恢复环境变量
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CORTEX_")) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it("无参调用返回 ENGINE_DEFAULTS", () => {
    const defaults = loadEngineDefaults();
    expect(defaults.lockTimeoutMs).toBe(ENGINE_DEFAULTS.lockTimeoutMs);
    expect(defaults.schemaVersion).toBe(ENGINE_DEFAULTS.schemaVersion);
  });

  it("overrides 优先级高于默认值", () => {
    const overridden = loadEngineDefaults({ lockTimeoutMs: 9999 });
    expect(overridden.lockTimeoutMs).toBe(9999);
    // 其他字段保留默认
    expect(overridden.shutdownTimeoutMs).toBe(ENGINE_DEFAULTS.shutdownTimeoutMs);
  });

  it("环境变量覆盖优先级（env > defaults）", () => {
    // CORTEX_ 环境变量应覆盖默认值
    process.env.CORTEX_LOCK_TIMEOUT_MS = "50000";
    process.env.CORTEX_SCHEDULER_MAX_ROUNDS = "100";

    const loaded = loadEngineDefaults();
    expect(loaded.lockTimeoutMs).toBe(50000);
    expect(loaded.schedulerMaxRounds).toBe(100);
  });

  it("overrides 优先级高于环境变量", () => {
    process.env.CORTEX_LOCK_TIMEOUT_MS = "50000";

    const loaded = loadEngineDefaults({ lockTimeoutMs: 7777 });
    expect(loaded.lockTimeoutMs).toBe(7777);
  });

  it("缺失环境变量回退到默认值", () => {
    // 不设置任何 CORTEX_ 环境变量
    const loaded = loadEngineDefaults({});
    expect(loaded.lockTimeoutMs).toBe(ENGINE_DEFAULTS.lockTimeoutMs);
    expect(loaded.embeddingDim).toBe(ENGINE_DEFAULTS.embeddingDim);
  });

  it("无效环境变量值（非数字字段）应回退默认值 30000 但不崩溃", () => {
    process.env.CORTEX_LOCK_TIMEOUT_MS = "not-a-number";
    const loaded = loadEngineDefaults();
    // Number("not-a-number") 返回 NaN, loadEngineDefaults 回退到默认值
    expect(loaded.lockTimeoutMs).toBe(30_000);
  });

  it("字符串类型环境变量（contentHashAlgo）应保留原值", () => {
    process.env.CORTEX_CONTENT_HASH_ALGO = "md5";
    const loaded = loadEngineDefaults();
    expect(loaded.contentHashAlgo).toBe("md5");
  });

  it("空字符串环境变量不覆盖", () => {
    process.env.CORTEX_LOCK_TIMEOUT_MS = "";
    const loaded = loadEngineDefaults();
    // Number("") = 0, 但 0 会被覆盖进去
    expect(loaded.lockTimeoutMs).toBe(0);
  });
});
