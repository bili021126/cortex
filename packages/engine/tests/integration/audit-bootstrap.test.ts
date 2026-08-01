// @ci: contract
// ============================================================
// @cortex/engine —— AuditTrail 真实调用点集成测试（spec S2-7 验收）
//
// 守护验收标准 3：audit.jsonl 出现 2+ 类 record* 条目（非仅 degradation）。
// 证据链：bootstrapEngine 真实启动 → §6.0.0a1 接线 →
//   engineConfig 传入 → config_override 条目落盘
//   config.warnings 非空 → config_violation 条目落盘
//
// 注意：audit.jsonl 是共享追加文件（多测试并发写），断言只查"存在性"
// 并按唯一标记过滤，不断言行数。
// ============================================================

import { describe, it, expect, beforeAll } from "vitest";
import { mockLlmAdapter } from "../fixtures/mock-adapter.js";
import { bootstrapEngine } from "@cortex/engine";
import { Toolkit } from "@cortex/platform";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomInt } from "node:crypto";

// ── 辅助 ────────────────────────────────────────

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
// bootstrapEngine 的 AuditTrail 默认目录：process.cwd()/.cortex/logs
// engine 包测试 cwd = packages/engine
const AUDIT_FILE = path.join(process.cwd(), ".cortex", "logs", "audit.jsonl");

function makeMockLLM(): Map<string, unknown> {
  const adapter = mockLlmAdapter("Task completed successfully.");
  return new Map([["default", adapter]]);
}

/** 读取 audit.jsonl 全部条目（损坏行跳过） */
function readAuditEntries(): Array<Record<string, unknown>> {
  if (!fs.existsSync(AUDIT_FILE)) return [];
  const content = fs.readFileSync(AUDIT_FILE, "utf-8");
  const entries: Array<Record<string, unknown>> = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // 损坏行跳过（AuditTrail 语义一致）
    }
  }
  return entries;
}

async function boot(engineConfig?: Record<string, unknown>) {
  const result = await bootstrapEngine(REPO_ROOT, {
    llms: makeMockLLM(),
    toolkit: new Toolkit(),
    engineConfig: engineConfig as never,
  });
  await result.shutdown();
  return result;
}

// ── 设置 ────────────────────────────────────────

beforeAll(() => {
  if (!fs.existsSync(path.dirname(AUDIT_FILE))) {
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
  }
});

// ═══════════════════════════════════════════════════════
// T1: config_override 真实调用点
// ═══════════════════════════════════════════════════════

describe("T1: bootstrap 传 engineConfig → config_override 落盘", () => {
  it("audit.jsonl 出现 config_override 条目且 newValue 含传入值", async () => {
    // 唯一标记：随机数注入 engineConfig，按标记过滤共享文件
    const marker = randomInt(100_000, 999_999);
    await boot({ defaultMaxLoops: marker });

    const entries = readAuditEntries().filter(
      (e) => e.type === "config_override"
        && e.key === "engineConfig"
        && String(e.newValue).includes(String(marker)),
    );
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]).toMatchObject({
      source: "bootstrapEngine.options",
      oldValue: "<default>",
    });
  });
});

// ═══════════════════════════════════════════════════════
// T2: config_violation 真实调用点
// ═══════════════════════════════════════════════════════

describe("T2: bootstrap 加载真实配置 → config_violation 落盘", () => {
  it("仓库配置存在跨字段 warnings 时 audit.jsonl 出现 config_violation", async () => {
    await boot();

    const violations = readAuditEntries().filter((e) => e.type === "config_violation");
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0]).toMatchObject({
      schemaName: "cross-field",
    });
    expect(Array.isArray(violations[0].errors)).toBe(true);
    expect((violations[0].errors as string[]).length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════
// T3: 验收标准 3 —— 2+ 类 record* 条目共存
// ═══════════════════════════════════════════════════════

describe("T3: audit.jsonl 存在 2+ 类 record* 条目（非仅 degradation）", () => {
  it("config_override 与 config_violation 同文件共存", async () => {
    const marker = randomInt(100_000, 999_999);
    await boot({ defaultMaxLoops: marker });

    const entries = readAuditEntries();
    const types = new Set(entries.map((e) => e.type));
    // 本测试至少产生 config_override（标记过滤）+
    // 共享文件历史/并发产生 config_violation → 2+ 类
    expect(entries.some((e) => e.type === "config_override" && String(e.newValue).includes(String(marker)))).toBe(true);
    expect(types.has("config_violation")).toBe(true);
    expect(types.size).toBeGreaterThanOrEqual(2);
  });
});
