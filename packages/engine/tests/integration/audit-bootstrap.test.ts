// @ci: integration
// ============================================================
// @cortex/engine —— AuditTrail 真实调用点集成测试（spec S2-7 验收）
//
// 守护验收标准 3：audit.jsonl 出现 2+ 类 record* 条目（非仅 degradation）。
// 证据链：bootstrapEngine 真实启动 → §6.0.0a1 recordBootstrapAudit 接线 →
//   engineConfig 传入 → config_override 条目落盘
//   config.warnings 非空 → config_violation 条目落盘
//
// 2026-09-26 自包含化：此前 T2/T3 断言「audit.jsonl 里存在 config_violation」，前提是
// 「仓库配置有跨字段违规」。2026-09-20 清掉 event-routing 的 22 条死路由后该前提消失，
// 干净 CI 下 T2/T3 必红，本地仅因历史残留才侥幸通过——那是**假绿**。
// 现在改为注入式：bootstrapEngine 接受 configDataDir（见 BootstrapEngineOptions），
// 测试把真实配置数据目录复制到临时目录、塞进一条带唯一标记的「无生产者路由」，
// 断言 audit.jsonl 出现**含该标记**的 config_violation。不依赖仓库当前配置态，也不依赖历史残留。
//
// 共享文件并发：audit.jsonl 由 cwd 下的运行时目录承担，断言一律按唯一标记过滤、不断言行数。
// ============================================================

import { describe, it, expect, beforeAll } from "vitest";
import { mockLlmAdapter } from "../fixtures/mock-adapter.js";
import { bootstrapEngine } from "@cortex/engine";
import { Toolkit } from "@cortex/platform";
import { resolveConfigDataDir } from "@cortex/config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomInt } from "node:crypto";

// ── 辅助 ────────────────────────────────────────

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
// bootstrapEngine 的 AuditTrail 默认目录：process.cwd()/.cortex/logs（共享——marker 过滤并发）
const AUDIT_FILE = path.join(process.cwd(), ".cortex", "logs", "audit.jsonl");
const AUDIT_DIR = path.dirname(AUDIT_FILE);

function makeMockLLM() {
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

/**
 * 造一份「带一条无生产者路由」的配置数据目录。
 *
 * 跨字段校验维度二：routeTable 里有条目但无任何 Agent 声明 produces 该事件 → 警告。
 * marker 让断言可以按内容过滤共享 audit.jsonl，不依赖行数或历史残留。
 */
function makeConfigDirWithDeadRoute(marker: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-config-probe-"));
  const srcDir = resolveConfigDataDir();
  for (const f of fs.readdirSync(srcDir)) {
    if (f.endsWith(".json")) {
      fs.copyFileSync(path.join(srcDir, f), path.join(dir, f));
    }
  }
  const routingPath = path.join(dir, "event-routing.json");
  const routing = JSON.parse(fs.readFileSync(routingPath, "utf-8")) as {
    routeTable: Record<string, { channel: string }>;
  };
  // 借用一个已存在的合法通道值——通道非法会变成 error（拒绝启动）而非 warning
  const sample = Object.values(routing.routeTable)[0];
  if (!sample) throw new Error("event-routing.json routeTable 为空，无法构造违规 fixture");
  routing.routeTable[`__audit_probe_${marker}`] = { channel: sample.channel };
  fs.writeFileSync(routingPath, JSON.stringify(routing, null, 2));
  return dir;
}

async function boot(engineConfig?: Record<string, unknown>, configDataDir?: string) {
  // H2 修复：db/工作区独立临时目录（audit 保持 cwd 共享——marker 过滤并发）
  const ws = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), "cortex-audit-ws-"));
  for (const rel of ["agents.json", "cortex-agents.json"]) {
    const src = path.join(REPO_ROOT, rel);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(ws, rel)); break; }
  }
  const result = await bootstrapEngine(ws, {
    llms: makeMockLLM(),
    toolkit: new Toolkit(),
    workspaceRoot: ws,
    dbPath: path.join(ws, ".cortex", "memory.db"),
    engineConfig: engineConfig as never,
    configDataDir,
  });
  await result.shutdown();
  return result;
}

// ── 设置 ────────────────────────────────────────

beforeAll(() => {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
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
// T2: config_violation 真实调用点（注入式，自包含）
// ═══════════════════════════════════════════════════════

describe("T2: 配置含跨字段警告 → config_violation 落盘", () => {
  it("注入无生产者路由后，audit.jsonl 出现含该标记的 config_violation", async () => {
    const marker = String(randomInt(100_000, 999_999));
    const configDir = makeConfigDirWithDeadRoute(marker);

    await boot(undefined, configDir);

    const violations = readAuditEntries().filter(
      (e) => e.type === "config_violation"
        && Array.isArray(e.errors)
        && (e.errors as string[]).some((x) => x.includes(marker)),
    );
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0]).toMatchObject({ schemaName: "cross-field" });
    expect((violations[0].errors as string[]).length).toBeGreaterThan(0);

    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("仓库真实配置下 bootstrap 可跑通（不注入违规，不依赖历史残留）", async () => {
    const marker = String(randomInt(100_000, 999_999));
    const configDir = makeConfigDirWithDeadRoute(marker);
    // 证明「警告只由注入产生」：清掉注入即无该标记的条目
    const routing = JSON.parse(fs.readFileSync(path.join(configDir, "event-routing.json"), "utf-8")) as {
      routeTable: Record<string, unknown>;
    };
    delete routing.routeTable[`__audit_probe_${marker}`];
    fs.writeFileSync(path.join(configDir, "event-routing.json"), JSON.stringify(routing, null, 2));

    await boot(undefined, configDir);

    const violations = readAuditEntries().filter(
      (e) => e.type === "config_violation"
        && Array.isArray(e.errors)
        && (e.errors as string[]).some((x) => x.includes(marker)),
    );
    expect(violations).toHaveLength(0);

    fs.rmSync(configDir, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════════════════════
// T3: 验收标准 3 —— 2+ 类 record* 条目共存
// ═══════════════════════════════════════════════════════

describe("T3: audit.jsonl 存在 2+ 类 record* 条目（非仅 degradation）", () => {
  it("同一次 bootstrap 产生的 config_override 与 config_violation 共存于同一文件", async () => {
    const marker = String(randomInt(100_000, 999_999));
    const configDir = makeConfigDirWithDeadRoute(marker);

    // 一次启动同时带 engineConfig（→ override）与注入违规（→ violation）
    await boot({ defaultMaxLoops: marker }, configDir);

    const entries = readAuditEntries();
    const types = new Set(entries.map((e) => e.type));

    // 两条都由本次调用产生，按 marker 双重确认（不依赖历史残留）
    expect(entries.some((e) => e.type === "config_override" && String(e.newValue).includes(marker))).toBe(true);
    expect(entries.some(
      (e) => e.type === "config_violation"
        && Array.isArray(e.errors)
        && (e.errors as string[]).some((x) => x.includes(marker)),
    )).toBe(true);
    expect(types.size).toBeGreaterThanOrEqual(2);

    fs.rmSync(configDir, { recursive: true, force: true });
  });
});
