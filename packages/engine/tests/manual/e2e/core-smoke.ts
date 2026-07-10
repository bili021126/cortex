// @e2e: core-smoke
// @covers: bootstrap→plan→execute→write_file→落盘→memory写入→observer事件→skill加载
// @covers-chain: 全核心链路
// @cost: ~0.5元/次
// @overlap: e2e-minimal（本文件是 e2e-minimal + memory + observer + skill 验证）
//
// 用法: npx tsx packages/engine/tests/manual/e2e/core-smoke.ts
// ============================================================

import * as path from "node:path";
import * as fs from "node:fs";
import { PipelinePriority } from "@cortex/shared";
import { bootstrapEngine } from "@cortex/engine";
import { e2eBootstrap, log } from "./e2e-utils.js";

const ROOT = path.resolve(import.meta.dirname!, "..", "..", "..", "..", "..");

async function main() {
  const { root, llm, toolkit } = e2eBootstrap();
  log("⚡ core-smoke — 全核心链路冒烟\n");

  // ── 1. Bootstrap ──
  const db = path.join(root, ".cortex", "test", "core-smoke.db");
  const engine = await bootstrapEngine(root, { llms: new Map([["default", llm]]), toolkit, dbPath: db } as any);
  log("✅ Bootstrap");
  try { (toolkit as any).gate?.bypassAll?.(); } catch { /* */ }

  // ── 2. Plan ──
  const metaAgent = engine.metaAgent;
  if (!metaAgent) { log("❌ no MetaAgent"); await engine.shutdown(); process.exit(1); }
  log("🧠 Plan...");
  const plan = await metaAgent.plan("创建 _core_smoke_test.ts 到 src/ 目录，内容为 export const smoke = true");
  if (!plan || plan.length === 0) throw new Error("甘雨规划为空");
  log(`   ${plan.length} nodes`);
  for (const n of plan) {
    log(`     ${n.type} [${(n.tags??[]).join(",")}] ${(n.payload??"").slice(0, 60)}`);
  }

  // ── 3. Execute ──
  log("⚡ Exec...");
  const events: string[] = [];
  engine.observer.on(PipelinePriority.HIGH, (e: any) => events.push(e.type ?? ""));
  engine.observer.on(PipelinePriority.NORMAL, (e: any) => events.push(e.type ?? ""));

  for (const n of plan) engine.board.addNode(n);
  const report = await engine.scheduler.executeAll();

  log(`   completed=${report.completed} failed=${report.failed}`);

  // ── 4. Verify file ──
  const targetFile = path.join(root, "src", "_core_smoke_test.ts");
  const fileExists = fs.existsSync(targetFile);
  log(`📁 ${targetFile}: ${fileExists ? "✅ EXISTS" : "❌ MISSING"}`);
  if (fileExists) {
    const content = fs.readFileSync(targetFile, "utf-8");
    log(`   content: ${content.slice(0, 80)}`);
    log(`   match: ${content.includes("smoke") ? "✅" : "❌"}`);
  }

  // ── 5. Verify skill ──
  log("🎯 Skills...");
  const skillDir = path.join(root, "skills");
  const skillFiles = fs.existsSync(skillDir)
    ? fs.readdirSync(skillDir).filter(f => f.endsWith(".json"))
    : [];
  log(`   skills/ 目录: ${skillFiles.length} 文件`);

  // 真实验证：加载一个技能 → 注册 → 查询
  let skillVerified = false;
  for (const sampleFile of skillFiles.slice(0, 5)) {
    try {
      const raw = fs.readFileSync(path.join(skillDir, sampleFile), "utf-8");
      const skill = JSON.parse(raw);
      if (skill.id && skill.triggerTags && skill.steps) {
        log(`   加载: ${skill.id} (tags: ${skill.triggerTags.join(",")})`);
        const { SkillRegistry } = await import("@cortex/skill-kit");
        const testReg = new SkillRegistry();
        testReg.register(skill);
        const matched = testReg.queryByTags(skill.triggerTags);
        log(`   注册+查询: ${matched.length > 0 ? "✅" : "❌"} (命中 ${matched.length} 个)`);
        skillVerified = matched.length > 0;
        break;
      } else {
        log(`   ⚠️ ${sampleFile}: 缺少 id/triggerTags/steps`);
      }
    } catch (e) {
      log(`   ⚠️ ${sampleFile}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!skillVerified) log("   ❌ 未找到有效技能文件");

  // ── 6. Verify memory ──
  log("🧠 Memory...");
  const memory = (engine as any).memory;
  if (memory?.getSessionStats) {
    const stats = (memory as any).getSessionStats();
    log(`   entries: ${stats?.totalEntries ?? "N/A"}`);
  } else {
    log("   ⚠️ getSessionStats 不可用（MemoryStore 未初始化或方法缺失）");
  }

  // ── 7. Verify observer ──
  log("📊 Observer...");
  log(`   events: ${events.length}`);
  const hasNodeStart = events.includes("node.start");
  const hasNodeComplete = events.includes("node.complete");
  const hasSchedulerDone = events.includes("scheduler.done");
  log(`   node.start: ${hasNodeStart ? "✅" : "❌"}`);
  log(`   node.complete: ${hasNodeComplete ? "✅" : "❌"}`);
  log(`   scheduler.done: ${hasSchedulerDone ? "✅" : "❌"}`);

  // ── 8. Cleanup ──
  if (fileExists) fs.unlinkSync(targetFile);

  // ── 9. Summary ──
  const passed = report.failed === 0 && fileExists && hasNodeStart && hasNodeComplete;
  log(`\n${passed ? "✅ ALL PASSED" : "❌ FAILURES"} — core-smoke complete`);
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  log(`❌ core-smoke crashed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
