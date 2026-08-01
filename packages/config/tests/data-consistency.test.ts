// @ci: unit
/**
 * @cortex/config — 数据域与常量/默认值一致性守护测试（A1）
 *
 * 守护事实：engine.json（data 域）与 constants/defaults 的数值不得漂移——
 * 同一语义只允许一个真相源，三处必须同值。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCHEDULER_MAX_TOTAL_REPLANS, EXECUTE_ALL_TIMEOUT_MS } from "../src/constants/scheduler-params.js";
import { DEFAULT_ENGINE_CONFIG } from "../src/defaults.js";

/** 读 data/engine.json（import.meta.url 基准，不依赖 cwd） */
function loadEngineJson(): Record<string, unknown> {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, "..", "src", "data", "engine.json");
  return JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
}

describe("A1: engine.json 与 constants/defaults 数值一致性", () => {
  const engineJson = loadEngineJson();

  it("maxTotalReplans 三处同值（10）", () => {
    expect(engineJson.maxTotalReplans).toBe(SCHEDULER_MAX_TOTAL_REPLANS);
    expect(engineJson.maxTotalReplans).toBe(DEFAULT_ENGINE_CONFIG.maxTotalReplans);
    expect(DEFAULT_ENGINE_CONFIG.maxTotalReplans).toBe(10);
  });

  it("executeAllTimeoutMs 三处同值（600s）", () => {
    expect(engineJson.executeAllTimeoutMs).toBe(EXECUTE_ALL_TIMEOUT_MS);
    expect(engineJson.executeAllTimeoutMs).toBe(DEFAULT_ENGINE_CONFIG.executeAllTimeoutMs);
    expect(DEFAULT_ENGINE_CONFIG.executeAllTimeoutMs).toBe(600_000);
  });

  it("engine.json 无死配置键 defaultMaxLoops（已删除，defaults 32 为准）", () => {
    expect(engineJson.defaultMaxLoops).toBeUndefined();
    expect(DEFAULT_ENGINE_CONFIG.defaultMaxLoops).toBe(32);
  });

  it("maxReplanPerNode 保持单源对齐（3）", () => {
    expect(engineJson.maxReplanPerNode).toBe(3);
    expect(DEFAULT_ENGINE_CONFIG.maxReplanPerNode).toBe(3);
  });
});
