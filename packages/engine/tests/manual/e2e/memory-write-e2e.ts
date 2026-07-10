/**
 * @e2e: memory-write-e2e
 * @covers: MemoryPipeline→MemoryStore 写入 → kind/source 字段 → 持久化
 * @covers-chain: Memory 写入链
 * @cost: ~0.5元/次
 * @overlap: 无
 *
 * 验证 MemoryPipeline→MemoryStore 写入链路：
 *   Agent 执行后，memory.db 中有新记录且 kind/source 字段正确。
 *
 * 用法: npx tsx packages/engine/tests/manual/e2e/memory-write-e2e.ts
 * ============================================================
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { PipelinePriority, type MemoryKind } from "@cortex/shared";
import { bootstrapEngine } from "@cortex/engine";
import { e2eBootstrap, log } from "./e2e-utils.js";
import Database from "better-sqlite3";

// ── 有效 MemoryKind 列表 ──────────────────────────
const VALID_KINDS: readonly MemoryKind[] = ["TaskLog", "Intent", "Insight", "Governance"] as const;

// ── SQLite 辅助 ────────────────────────────────────

/**
 * 读取 memory.db 中的记忆行数。
 * 文件不存在时返回 0（首次执行前尚无持久化）。
 */
function getMemoryRowCount(dbPath: string): number {
  if (!fs.existsSync(dbPath)) return 0;
  try {
    const db = new Database(dbPath, { readonly: true });
    const r = db.prepare("SELECT COUNT(*) as c FROM memories").get() as any;
    db.close();
    return r.c;
  } catch (e) {
    log(`   ⚠️ getMemoryRowCount 失败: ${e instanceof Error ? e.message : String(e)}`);
    return -1;
  }
}

/**
 * 读取 memory.db 中最后一条记忆条目。
 * 文件不存在时返回 null。
 */
function getLastMemoryEntry(dbPath: string): any {
  if (!fs.existsSync(dbPath)) return null;
  try {
    const db = new Database(dbPath, { readonly: true });
    const r = db.prepare("SELECT * FROM memories ORDER BY rowid DESC LIMIT 1").get() as any;
    db.close();
    return r;
  } catch (e) {
    log(`   ⚠️ getLastMemoryEntry 失败: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// ── 验证函数 ────────────────────────────────────────

/** 验证 kind 是否为有效值 */
function isValidKind(kind: string): boolean {
  return (VALID_KINDS as readonly string[]).includes(kind);
}

// ── 主流程 ──────────────────────────────────────────

const TARGET = "src/_mem_write_e2e_test.ts";
const TARGET_CONTENT = "// memory-write-e2e auto-generated\nexport const memWrite = true;\n";

async function main() {
  const { root, llm, toolkit } = e2eBootstrap();
  log("⚡ memory-write-e2e — Memory 写入链路验证\n");

  // ── 1. Bootstrap ──
  const db = path.join(root, ".cortex", "test", "memory-write-e2e.db");
  const engine = await bootstrapEngine(root, { llms: new Map([["default", llm]]), toolkit, dbPath: db } as any);
  log("✅ Bootstrap");
  try { (toolkit as any).gate?.bypassAll?.(); } catch { /* */ }

  // ── 2. 记录执行前的 memory 状态（行数） ──
  const beforeRows = getMemoryRowCount(db);
  log(`📊 memory rows before: ${beforeRows}`);

  // ── 3. Plan ──
  const metaAgent = engine.metaAgent;
  if (!metaAgent) { log("❌ no MetaAgent"); await engine.shutdown(); process.exit(1); }
  log("🧠 Plan...");
  const plan = await metaAgent.plan(`创建 ${TARGET}，内容为：${TARGET_CONTENT}。直接调用 write_file 写入。`);
  if (!plan || plan.length === 0) throw new Error("规划为空");
  log(`   ${plan.length} nodes`);
  for (const n of plan) {
    log(`     ${n.type} [${(n.tags ?? []).join(",")}] ${(n.payload ?? "").slice(0, 60)}`);
  }

  // ── 4. Execute ──
  log("⚡ Exec...");
  for (const n of plan) engine.board.addNode(n);
  const report = await engine.scheduler.executeAll();
  log(`   completed=${report.completed} failed=${report.failed}`);

  // ── 5. Verify file（执行结果凭证） ──
  const targetFile = path.join(root, TARGET);
  const fileExists = fs.existsSync(targetFile);
  log(`📁 ${targetFile}: ${fileExists ? "✅ EXISTS" : "❌ MISSING"}`);

  // ── 6. 验证 memory 行数增长 ──
  const afterRows = getMemoryRowCount(db);
  log(`\n🧠 memory rows: ${beforeRows} → ${afterRows}`);

  const rowIncreased = afterRows > beforeRows && afterRows > 0;
  if (!rowIncreased) {
    log(`   ❌ MemoryPipeline 未写入: ${beforeRows} → ${afterRows}`);
  } else {
    log(`   ✅ rows increased by ${afterRows - beforeRows}`);
  }

  // ── 7. 验证 kind/source 字段 ──
  let kindValid = false;
  let sourceValid = false;

  if (rowIncreased) {
    const last = getLastMemoryEntry(db);
    if (last) {
      log(`   kind: ${last.kind}`);
      kindValid = isValidKind(last.kind);
      log(`   kind 有效: ${kindValid ? "✅" : "❌"}（应为 TaskLog/Intent/Insight/Governance 之一）`);

      // source 是 JSON 字符串（SQLite TEXT 存储），需反序列化
      let source: any = last.source;
      if (typeof source === "string") {
        try { source = JSON.parse(source); } catch { /* 保留原始字符串 */ }
      }
      log(`   source: ${JSON.stringify(source)}`);

      const hasAgentType = source?.agentType && typeof source.agentType === "string" && source.agentType.length > 0;
      const hasTaskId = source?.taskId && typeof source.taskId === "string" && source.taskId.length > 0;

      if (hasAgentType) log(`   source.agentType: ${source.agentType} ✅`);
      else log(`   source.agentType: ${source?.agentType ?? "MISSING"} ❌`);

      if (hasTaskId) log(`   source.taskId: ${source.taskId} ✅`);
      else log(`   source.taskId: ${source?.taskId ?? "MISSING"} ❌`);

      sourceValid = hasAgentType && hasTaskId;
    } else {
      log("   ❌ 无法获取最后一条记忆条目");
    }
  }

  // ── 8. Cleanup ──
  if (fileExists) fs.unlinkSync(targetFile);

  // ── 9. Summary ──
  const passed = report.failed === 0 && rowIncreased && kindValid && sourceValid;
  log(`\n${passed ? "✅ ALL PASSED" : "❌ FAILURES"} — memory-write-e2e complete`);
  await engine.shutdown();
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  log(`❌ memory-write-e2e crashed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
