// @ci: unit
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_LOCK_TIMEOUT_MS,
  CLEANUP_INTERVAL_MS,
  SHUTDOWN_TIMEOUT_MS,
  SHUTDOWN_FORCE_EXIT_DELAY_MS,
  SCHEDULER_MAX_ROUNDS,
  SCHEDULER_ROUND_TIMEOUT_MS,
  REACT_MAX_LOOPS,
  EMBEDDING_DIM,
  EMBEDDING_CACHE_SIZE,
  CONTENT_HASH_ALGO,
  VECTOR_DEDUP_THRESHOLD,
  WEIGHT_AGING_FACTOR,
  STALE_FREEZE_DAYS,
  FROZEN_OBLITERATE_DAYS,
  MAINTENANCE_WEIGHT_THRESHOLD,
  MAX_TOTAL_MEMORIES,
  SCHEMA_VERSION,
  MONITOR_WINDOW_MS,
  MONITOR_THRESHOLD,
  ENGINE_DEFAULTS,
  loadEngineDefaults,
  type EngineDefaults,
} from "@cortex/config";

// ── 常量值校验 ──────────────────────────────

describe("engine-defaults — 常量值", () => {
  it("DEFAULT_LOCK_TIMEOUT_MS = 30s", () => {
    expect(DEFAULT_LOCK_TIMEOUT_MS).toBe(30_000);
  });

  it("CLEANUP_INTERVAL_MS = 60s", () => {
    expect(CLEANUP_INTERVAL_MS).toBe(60_000);
  });

  it("SHUTDOWN_TIMEOUT_MS = 15s", () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBe(15_000);
  });

  it("SHUTDOWN_FORCE_EXIT_DELAY_MS = 2s", () => {
    expect(SHUTDOWN_FORCE_EXIT_DELAY_MS).toBe(2_000);
  });

  it("SCHEDULER_MAX_ROUNDS = 25", () => {
    expect(SCHEDULER_MAX_ROUNDS).toBe(25);
  });

  it("SCHEDULER_ROUND_TIMEOUT_MS = 120s", () => {
    expect(SCHEDULER_ROUND_TIMEOUT_MS).toBe(120_000);
  });

  it("REACT_MAX_LOOPS = 20", () => {
    expect(REACT_MAX_LOOPS).toBe(20);
  });

  it("EMBEDDING_DIM = 384", () => {
    expect(EMBEDDING_DIM).toBe(384);
  });

  it("EMBEDDING_CACHE_SIZE = 10_000", () => {
    expect(EMBEDDING_CACHE_SIZE).toBe(10_000);
  });

  it("CONTENT_HASH_ALGO = sha256", () => {
    expect(CONTENT_HASH_ALGO).toBe("sha256");
  });

  it("VECTOR_DEDUP_THRESHOLD = 0.95", () => {
    expect(VECTOR_DEDUP_THRESHOLD).toBe(0.95);
  });

  it("WEIGHT_AGING_FACTOR = 0.95", () => {
    expect(WEIGHT_AGING_FACTOR).toBe(0.95);
  });

  it("STALE_FREEZE_DAYS = 30", () => {
    expect(STALE_FREEZE_DAYS).toBe(30);
  });

  it("FROZEN_OBLITERATE_DAYS = 7", () => {
    expect(FROZEN_OBLITERATE_DAYS).toBe(7);
  });

  it("MAINTENANCE_WEIGHT_THRESHOLD = 0.05", () => {
    expect(MAINTENANCE_WEIGHT_THRESHOLD).toBe(0.05);
  });

  it("SCHEMA_VERSION = 5", () => {
    expect(SCHEMA_VERSION).toBe(5);
  });

  it("MONITOR_WINDOW_MS = 60s", () => {
    expect(MONITOR_WINDOW_MS).toBe(60_000);
  });

  it("MONITOR_THRESHOLD = 10", () => {
    expect(MONITOR_THRESHOLD).toBe(10);
  });
});

// ── ENGINE_DEFAULTS 单例校验 ───────────────

describe("ENGINE_DEFAULTS — 单例", () => {
  it("所有字段已定义", () => {
    const requiredKeys: (keyof EngineDefaults)[] = [
      "lockTimeoutMs",
      "cleanupIntervalMs",
      "shutdownTimeoutMs",
      "shutdownForceExitDelayMs",
      "schedulerMaxRounds",
      "schedulerRoundTimeoutMs",
      "reactMaxLoops",
      "embeddingDim",
      "embeddingCacheSize",
      "contentHashAlgo",
      "vectorDedupThreshold",
      "weightAgingFactor",
      "staleFreezeDays",
      "frozenObliterateDays",
      "maintenanceWeightThreshold",
      "maxTotalMemories",
      "schemaVersion",
      "monitorWindowMs",
      "monitorThreshold",
    ];
    for (const key of requiredKeys) {
      expect(ENGINE_DEFAULTS[key]).toBeDefined();
    }
  });

  it("lockTimeoutMs 默认 30s", () => {
    expect(ENGINE_DEFAULTS.lockTimeoutMs).toBe(30_000);
  });
});

// ── loadEngineDefaults 测试 ─────────────────

describe("loadEngineDefaults", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // 清理 CORTEX_ 环境变量
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CORTEX_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("无参数返回默认值", () => {
    const config = loadEngineDefaults();
    expect(config.lockTimeoutMs).toBe(30_000);
    expect(config.schemaVersion).toBe(5);
  });

  it("overrides 部分覆盖默认值", () => {
    const config = loadEngineDefaults({ lockTimeoutMs: 60_000, schemaVersion: 6 });
    expect(config.lockTimeoutMs).toBe(60_000);
    expect(config.schemaVersion).toBe(6);
    // 未覆盖的字段保持默认
    expect(config.cleanupIntervalMs).toBe(60_000);
    expect(config.embeddingDim).toBe(384);
  });

  it("环境变量覆盖", () => {
    process.env.CORTEX_LOCK_TIMEOUT_MS = "45000";
    process.env.CORTEX_EMBEDDING_DIM = "768";
    const config = loadEngineDefaults();
    expect(config.lockTimeoutMs).toBe(45000);
    expect(config.embeddingDim).toBe(768);
    // 未设置环境变量的字段保持默认
    expect(config.schemaVersion).toBe(5);
  });

  it("overrides 优先级高于环境变量", () => {
    process.env.CORTEX_LOCK_TIMEOUT_MS = "45000";
    const config = loadEngineDefaults({ lockTimeoutMs: 90000 });
    expect(config.lockTimeoutMs).toBe(90000);
  });

  it("环境变量非数字值保留字符串", () => {
    process.env.CORTEX_CONTENT_HASH_ALGO = "sha512";
    const config = loadEngineDefaults();
    expect(config.contentHashAlgo).toBe("sha512");
  });

  it("忽略非 CORTEX_ 前缀的环境变量", () => {
    process.env.OTHER_VAR = "ignored";
    const config = loadEngineDefaults();
    expect((config as any).other_var).toBeUndefined();
  });
});
