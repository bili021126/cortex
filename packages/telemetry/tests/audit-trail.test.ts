// @ci: unit
// ============================================================
// @cortex/telemetry —— AuditTrail 审计跟踪单元测试（spec S2-7）
//
// 守护验收标准 3：audit.jsonl 出现 2+ 类 record* 条目（非仅 degradation）。
// 覆盖五类 record* 的落盘内容与字段完整性。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

import { AuditTrail } from "../src/index.js";
import type { AuditEntry } from "../src/index.js";

const TEST_DIR = join(tmpdir(), "cortex-audit-test", randomUUID());

function makeTrail(): AuditTrail {
  return new AuditTrail(TEST_DIR);
}

async function readEntries(): Promise<AuditEntry[]> {
  const file = join(TEST_DIR, "audit.jsonl");
  if (!existsSync(file)) return [];
  const content = await readFile(file, "utf-8");
  return content.split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditEntry);
}

describe("AuditTrail record*（spec S2-7）", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("recordConfigOverride 落盘 config_override 条目（key/source/old/new 完整）", async () => {
    const trail = makeTrail();
    trail.recordConfigOverride({
      key: "engineConfig",
      source: "bootstrapEngine.options",
      oldValue: "<default>",
      newValue: '{"defaultMaxLoops":64}',
    });
    trail.close();

    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "config_override",
      key: "engineConfig",
      source: "bootstrapEngine.options",
      oldValue: "<default>",
      newValue: '{"defaultMaxLoops":64}',
    });
    expect(entries[0].id).toBeTruthy();
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  it("recordConfigReload 落盘 config_reload 条目（watchPath/changedKeys 完整）", async () => {
    const trail = makeTrail();
    trail.recordConfigReload("/abs/path/tuning.json", ["defaultMaxLoops", "inspectorMaxLoops"]);
    trail.close();

    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "config_reload",
      watchPath: "/abs/path/tuning.json",
      changedKeys: ["defaultMaxLoops", "inspectorMaxLoops"],
    });
  });

  it("recordConfigViolation 落盘 config_violation 条目（schemaName/errors 完整）", async () => {
    const trail = makeTrail();
    trail.recordConfigViolation("cross-field", ["routeTable 定义了未声明事件路由", "toolPermissions 含未知工具"]);
    trail.close();

    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "config_violation",
      schemaName: "cross-field",
    });
    expect((entries[0] as Extract<AuditEntry, { type: "config_violation" }>).errors).toHaveLength(2);
  });

  it("recordDomainFilter 落盘 domain_filter 条目（allowed/blocked/stats 完整）", async () => {
    const trail = makeTrail();
    trail.recordDomainFilter({
      query: "*",
      allowed: ["engineering"],
      blocked: ["medical"],
      stats: { total: 5, allowedCount: 3, blockedCount: 2 },
    });
    trail.close();

    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "domain_filter",
      query: "*",
      allowed: ["engineering"],
      blocked: ["medical"],
      stats: { total: 5, allowedCount: 3, blockedCount: 2 },
    });
  });

  it("recordDegradation 落盘 degradation 条目（source/level/errorType 完整）", async () => {
    const trail = makeTrail();
    trail.recordDegradation("alert-engine", "notice", "idle_rate_high");
    trail.close();

    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "degradation",
      source: "alert-engine",
      level: "notice",
      errorType: "idle_rate_high",
    });
  });

  it("同一文件可累积 2+ 类条目（验收标准 3：非仅 degradation）", async () => {
    const trail = makeTrail();
    trail.recordConfigOverride({ key: "engineConfig", source: "opt", oldValue: "<default>", newValue: "{}" });
    trail.recordDomainFilter({ query: "*", allowed: ["engineering"], blocked: [], stats: { total: 1, allowedCount: 1, blockedCount: 0 } });
    trail.recordDegradation("smoke", "trace", "Error");
    trail.close();

    const entries = await readEntries();
    const types = new Set(entries.map((e) => e.type));
    expect(types.size).toBeGreaterThanOrEqual(2);
    expect(types).toContain("config_override");
    expect(types).toContain("domain_filter");
  });

  it("queryBySpan 按 spanId 扫描过滤（读取端基础能力）", async () => {
    const trail = makeTrail();
    // 手动构造两条带 spanId 的行（record* 当前不产 spanId，读取端用于后续扩展）
    await writeFile(
      join(TEST_DIR, "audit.jsonl"),
      [
        JSON.stringify({ id: "a1", timestamp: 1, type: "config_override", key: "k", source: "s", oldValue: "o", newValue: "n", spanId: "span-1" }),
        JSON.stringify({ id: "a2", timestamp: 2, type: "config_override", key: "k", source: "s", oldValue: "o", newValue: "n", spanId: "span-2" }),
        "not-json\n",
      ].join("\n") + "\n",
    );

    const matched = trail.queryBySpan("span-2");
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe("a2");

    // 损坏行跳过，不抛错
    const none = trail.queryBySpan("no-such-span");
    expect(none).toHaveLength(0);
    trail.close();
  });
});

// ============================================================
// config_violation 幂等（回归：audit.jsonl 曾被同一警告撑到 882 条 / 68% 体积）
//
// 跨进程场景是关键——每次 bootstrap 都是新进程、新实例，进程内 Set 挡不住，
// 因此去重必须落到磁盘。下列测试以「连续新建实例」模拟连续 bootstrap。
// ============================================================

describe("AuditTrail config_violation 幂等", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  const VIOLATION = ["跨字段校验警告: routeTable 中定义了 \"code_changed\" 的路由，但没有 Agent 声明 produces 该事件"];

  it("同一实例重复上报同一违规只落盘一次", async () => {
    const trail = makeTrail();
    trail.recordConfigViolation("cross-field", VIOLATION);
    trail.recordConfigViolation("cross-field", [...VIOLATION]);
    trail.close();

    const entries = await readEntries();
    expect(entries).toHaveLength(1);
  });

  it("跨实例（模拟连续 bootstrap）重复上报同一违规只落盘一次", async () => {
    // 三次 bootstrap = 三个进程 = 三个实例，各自实例内缓存都是空的
    for (let i = 0; i < 3; i++) {
      const trail = makeTrail();
      trail.recordConfigViolation("cross-field", VIOLATION);
      trail.close();
    }

    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    expect((entries[0] as Extract<AuditEntry, { type: "config_violation" }>).errors).toEqual(VIOLATION);
  });

  it("配置修复后 errors 变化 → 记一条新的（幂等不会压掉真实变化）", async () => {
    const first = makeTrail();
    first.recordConfigViolation("cross-field", VIOLATION);
    first.close();

    const second = makeTrail();
    second.recordConfigViolation("cross-field", ["跨字段校验警告: toolPermissions 含未知工具: \"rm_rf\""]);
    second.close();

    const entries = await readEntries();
    expect(entries).toHaveLength(2);
  });

  it("同一 errors 但 schemaName 不同 → 视为不同违规", async () => {
    const first = makeTrail();
    first.recordConfigViolation("cross-field", VIOLATION);
    first.close();

    const second = makeTrail();
    second.recordConfigViolation("tool-permission", VIOLATION);
    second.close();

    expect(await readEntries()).toHaveLength(2);
  });

  it("errors 顺序敏感——签名不做排序（避免把不同顺序误判为同一状态）", async () => {
    const first = makeTrail();
    first.recordConfigViolation("cross-field", ["a", "b"]);
    first.close();

    const second = makeTrail();
    second.recordConfigViolation("cross-field", ["b", "a"]);
    second.close();

    expect(await readEntries()).toHaveLength(2);
  });

  it("磁盘上已有违规行时，新实例不再追加（跨进程去重依赖读盘播种）", async () => {
    await writeFile(
      join(TEST_DIR, "audit.jsonl"),
      JSON.stringify({ id: "seed", timestamp: 1, type: "config_violation", schemaName: "cross-field", errors: VIOLATION }) + "\n",
    );

    const trail = makeTrail();
    trail.recordConfigViolation("cross-field", VIOLATION);
    trail.close();

    expect(await readEntries()).toHaveLength(1);
  });

  it("损坏行不影响播种——其后仍能正确判重", async () => {
    await writeFile(
      join(TEST_DIR, "audit.jsonl"),
      [
        "not-json",
        JSON.stringify({ id: "seed", timestamp: 1, type: "config_violation", schemaName: "cross-field", errors: VIOLATION }),
      ].join("\n") + "\n",
    );

    const trail = makeTrail();
    trail.recordConfigViolation("cross-field", VIOLATION);
    trail.recordConfigViolation("cross-field", ["另一条"]);
    trail.close();

    // 三条物理行 = 损坏行 + 播种行 + 新增的「另一条」
    const raw = await readFile(join(TEST_DIR, "audit.jsonl"), "utf-8");
    expect(raw.split("\n").filter(Boolean)).toHaveLength(3);
    expect(raw).toContain("另一条");
    expect(raw.split("跨字段校验警告").length - 1).toBe(1);
  });

  it("幂等只适用于 config_violation——事件类 record* 仍逐次追加", async () => {
    const trail = makeTrail();
    trail.recordDegradation("smoke", "trace", "Error");
    trail.recordDegradation("smoke", "trace", "Error");
    trail.recordConfigOverride({ key: "engineConfig", source: "opt", oldValue: "<default>", newValue: "{}" });
    trail.recordConfigOverride({ key: "engineConfig", source: "opt", oldValue: "<default>", newValue: "{}" });
    trail.recordDomainFilter({ query: "*", allowed: ["engineering"], blocked: [], stats: { total: 1, allowedCount: 1, blockedCount: 0 } });
    trail.recordDomainFilter({ query: "*", allowed: ["engineering"], blocked: [], stats: { total: 1, allowedCount: 1, blockedCount: 0 } });
    trail.recordConfigReload("/abs/tuning.json", ["defaultMaxLoops"]);
    trail.recordConfigReload("/abs/tuning.json", ["defaultMaxLoops"]);
    trail.close();

    const entries = await readEntries();
    expect(entries).toHaveLength(8);
  });
});
