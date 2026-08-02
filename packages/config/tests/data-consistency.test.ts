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
import { validateJsonSchema } from "../src/loader.js";
import {
  MCP_SERVERS_SCHEMA,
  SELF_EXAMINATION_SCHEMA,
  CROSS_VERIFICATION_SCHEMA,
  SEED_MEMORIES_SCHEMA,
  GOVERNANCE_PIPELINE_SCHEMA,
} from "../src/schemas/index.js";

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

// ═══════════════════════════════════════════════════
// C2：第二批 5 域 schema 守护——默认数据文件必须通过校验，坏数据必须被拒
// ═══════════════════════════════════════════════════

describe("C2: 第二批 schema 对默认数据文件校验（mcpServers/selfExamination/crossVerification/seedMemories/governancePipeline）", () => {
  const here = dirname(fileURLToPath(import.meta.url));

  /** 读 data/ 下某 JSON 文件，按 dataKey 提取后校验 */
  function validateDataFile(fileName: string, schema: Parameters<typeof validateJsonSchema>[1], dataKey?: string) {
    const raw = JSON.parse(readFileSync(join(here, "..", "src", "data", fileName), "utf-8")) as Record<string, unknown>;
    const data = dataKey ? (raw as Record<string, unknown>)[dataKey] : raw;
    return validateJsonSchema(data, schema);
  }

  it("mcp-servers.json 的 servers 映射通过 MCP_SERVERS_SCHEMA", () => {
    expect(validateDataFile("mcp-servers.json", MCP_SERVERS_SCHEMA, "servers")).toEqual([]);
  });

  it("self-examination.json 通过 SELF_EXAMINATION_SCHEMA（hard/soft 数组）", () => {
    expect(validateDataFile("self-examination.json", SELF_EXAMINATION_SCHEMA)).toEqual([]);
  });

  it("cross-verification.json 的 pairs 通过 CROSS_VERIFICATION_SCHEMA", () => {
    expect(validateDataFile("cross-verification.json", CROSS_VERIFICATION_SCHEMA, "pairs")).toEqual([]);
  });

  it("seed-memories.json 的 entries 通过 SEED_MEMORIES_SCHEMA", () => {
    expect(validateDataFile("seed-memories.json", SEED_MEMORIES_SCHEMA, "entries")).toEqual([]);
  });

  it("governance-pipeline.json 通过 GOVERNANCE_PIPELINE_SCHEMA", () => {
    expect(validateDataFile("governance-pipeline.json", GOVERNANCE_PIPELINE_SCHEMA)).toEqual([]);
  });

  it("坏数据被拒：cross-verification 缺 verifierKey 的配对必须报错", () => {
    const bad = [{ reporterKey: "a", verifierKey: "b" }, { reporterKey: "c" }];
    const errors = validateJsonSchema(bad, CROSS_VERIFICATION_SCHEMA);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("坏数据被拒：governance-pipeline 缺 stages 必须报错", () => {
    const bad = { enabled: true, ciGate: {}, triggers: {} };
    const errors = validateJsonSchema(bad, GOVERNANCE_PIPELINE_SCHEMA);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("坏数据被拒：mcpServers 的 server 缺 transport 必须报错", () => {
    const bad = { bing: { command: "npx", args: [] } };
    const errors = validateJsonSchema(bad, MCP_SERVERS_SCHEMA);
    expect(errors.length).toBeGreaterThan(0);
  });
});
