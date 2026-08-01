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
