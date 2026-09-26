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
  EVENT_ROUTING_SCHEMA,
  ARCHITECTURE_FLOWS_SCHEMA,
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

// ═══════════════════════════════════════════════════════
// R13-D2：event-routing.json 的 mergeRules
//
// 此前 EVENT_ROUTING_SCHEMA 没有声明 mergeRules，配置文件里也从未出现过它——
// 而 engine 侧 cross-field.validator 维度三早就在按 mergeRules 做校验，
// NotificationPipe.setMergeRules 也早就存在但零调用。
// 现在 schema / 数据 / 消费方三处对齐，由本测试守住。
// ═══════════════════════════════════════════════════════

describe("R13-D2: event-routing.json 通过 EVENT_ROUTING_SCHEMA", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(
    readFileSync(join(here, "..", "src", "data", "event-routing.json"), "utf-8"),
  ) as Record<string, unknown>;

  it("默认数据文件整份通过校验", () => {
    expect(validateJsonSchema(raw, EVENT_ROUTING_SCHEMA)).toEqual([]);
  });

  it('mergeRules 已声明且含 groupBy = "mergeKey"（NotificationPipe 只认这个）', () => {
    const rules = raw.mergeRules as Array<Record<string, unknown>>;
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((r) => r.groupBy === "mergeKey")).toBe(true);
  });

  it("坏数据被拒：mergeRule 缺 maxBatch 必须报错", () => {
    const bad = { routeTable: {}, mergeRules: [{ groupBy: "mergeKey", windowMs: 5000 }] };
    const errors = validateJsonSchema(bad, EVENT_ROUTING_SCHEMA);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("坏数据被拒：mergeRule 缺 groupBy 必须报错", () => {
    const bad = { routeTable: {}, mergeRules: [{ windowMs: 5000, maxBatch: 100 }] };
    const errors = validateJsonSchema(bad, EVENT_ROUTING_SCHEMA);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════
// 架构流映射（五流六层 ↔ 代码落点）
//
// 语义由 packages/tools/tests/flow-contract.test.ts（@ci: contract）强制；
// 此处只守数据文件的形状，确保 schema 声明的必填字段真实存在。
// ═══════════════════════════════════════════════════════

describe("架构流映射数据文件通过 ARCHITECTURE_FLOWS_SCHEMA", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(
    readFileSync(join(here, "..", "src", "data", "architecture-flows.json"), "utf-8"),
  ) as Record<string, unknown>;

  it("默认数据文件整份通过校验", () => {
    expect(validateJsonSchema(raw, ARCHITECTURE_FLOWS_SCHEMA)).toEqual([]);
  });

  it("必备的四个键都在（flows / principles / layers / knownUnassigned）", () => {
    expect(Array.isArray(raw.flows)).toBe(true);
    expect(Array.isArray(raw.principles)).toBe(true);
    expect(Array.isArray(raw.layers)).toBe(true);
    // knownUnassigned 允许为空数组，但必须存在——它是双向契约的一半
    expect(Array.isArray(raw.knownUnassigned)).toBe(true);
  });

  it("坏数据被拒：flow 缺 directories 必须报错", () => {
    const bad = {
      flows: [{ id: "x", name: "X", layer: "交互层", question: "?", principles: [] }],
      principles: [],
      layers: [],
      knownUnassigned: [],
    };
    const errors = validateJsonSchema(bad, ARCHITECTURE_FLOWS_SCHEMA);
    expect(errors.length).toBeGreaterThan(0);
  });
});
