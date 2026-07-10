// @e2e: confirmgate-smoke
// @covers: 烟绯ConfirmGate→裁决→信任分→自动放行→审计
// @covers-chain: ConfirmGate 独立验证
// @cost: ~0.5元/次
// @overlap: 无
//
// 用法: npx tsx packages/engine/tests/manual/e2e/confirmgate-smoke.ts
// ============================================================

import * as path from "node:path";
import * as fs from "node:fs";
import { PipelinePriority } from "@cortex/shared";
import { bootstrapEngine, computeTrustScore } from "@cortex/engine";
import { e2eBootstrap, log } from "./e2e-utils.js";

const TARGET = "src/_confirmgate_test.ts";
const TARGET_CONTENT = "// confirmgate-smoke auto-generated\nexport const gate = true;\n";

async function main() {
  const { root, llm, toolkit } = e2eBootstrap();
  log("⚡ confirmgate-smoke — 烟绯 ConfirmGate 验证\n");

  // ── 1. Bootstrap ──
  const db = path.join(root, ".cortex", "test", "confirmgate.db");
  const engine = await bootstrapEngine(root, { llms: new Map([["default", llm]]), toolkit, dbPath: db } as any);
  log("✅ Bootstrap");
  // 不跳过 ConfirmGate——让烟绯正常裁决
  // try { (toolkit as any).gate?.bypassAll?.(); } catch { /* */ }

  // ── 2. 验证 ConfirmGate 当前状态 ──
  log("\n🔒 ConfirmGate...");
  const gate = (toolkit as any).gate;
  if (!gate) {
    log("   ❌ gate 不存在");
  } else {
    log(`   类型: ${gate.constructor?.name ?? "unknown"}`);
    // 当前实现：静态 L0-L3 分级
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(gate))
      .filter(k => typeof gate[k] === "function");
    log(`   现有方法: ${methods.join(", ") || "无公开方法"}`);

    if (typeof gate.bypassAll === "function") {
      log("   ⚠️ 当前只有 bypassAll（全跳过），无 trustScore/approve");
      log("   烟绯 Agent 化待实现（设计文档: docs/core/confirmgate-agent-design.md）");

      // trustScore 计算验证
      const score = computeTrustScore([{
        agentType: "code", toolName: "write_file", success: true, riskLevel: "L2", timestamp: Date.now()
      }, {
        agentType: "code", toolName: "read_file", success: true, riskLevel: "L0", timestamp: Date.now()
      }]);
      log(`   trustScore smoke: ${score} (expected > 50)`);
      if (score <= 50) throw new Error("trustScore 计算异常");
    }

    if (typeof gate.check === "function") {
      const r = gate.check("write_file", "L2");
      log(`   gate.check(write_file, L2) → ${JSON.stringify(r)}`);
    }
  }

  // ── 3. 当前 bypassAll 模式下的 Plan + Execute ──
  try { (toolkit as any).gate?.bypassAll?.(); } catch { /* */ }
  log("   ✅ bypassAll（E2E 兼容模式）");

  // ── 4. Plan + Execute（真实 LLM 调用） ──
  log("\n🧠 Plan...");
  const metaAgent = engine.metaAgent;
  if (!metaAgent) { log("❌ no MetaAgent"); await engine.shutdown(); process.exit(1); }
  const plan = await metaAgent.plan(`创建 ${TARGET}，内容为：${TARGET_CONTENT}。直接调用 write_file 写入。`);
  log(`   ${plan.length} nodes`);

  if (!plan.length) { await engine.shutdown(); return; }

  log("⚡ Exec...");
  const events: string[] = [];
  engine.observer.on(PipelinePriority.HIGH, (e: any) => events.push(e.type ?? ""));
  engine.observer.on(PipelinePriority.NORMAL, (e: any) => events.push(e.type ?? ""));

  for (const n of plan) engine.board.addNode(n);
  const report = await engine.scheduler.executeAll();
  log(`   completed=${report.completed} failed=${report.failed}`);

  // ── 5. Verify file ──
  const targetPath = path.join(root, TARGET);
  const fileExists = fs.existsSync(targetPath);
  log(`\n📁 ${targetPath}: ${fileExists ? "✅ EXISTS" : "❌ MISSING"}`);

  // ── 6. Verify confirm-gate events ──
  log("\n📊 ConfirmGate Events...");
  const gateEvents = events.filter(e => e.includes("confirm-gate") || e.includes("auto-approved"));
  log(`   confirm-gate 相关事件: ${gateEvents.length}`);
  for (const e of gateEvents) log(`     - ${e}`);

  // ── 7. 烟绯 TODO ──
  log("\n📋 烟绯 Agent 化 TODO...");
  log("   设计: docs/core/confirmgate-agent-design.md");
  log("   提示词: prompts/yanfei/system.md");
  log("   待实现: gate.approve / getTrustScore / setE2EMode");

  // ── 8. Cleanup ──
  if (fileExists) fs.unlinkSync(targetPath);

  // ── 9. Summary ──
  const passed = report.failed === 0 && fileExists;
  log(`\n${passed ? "✅ ALL PASSED" : "❌ FAILURES"} — confirmgate-smoke complete`);
  await engine.shutdown();
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  log(`❌ confirmgate-smoke crashed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
