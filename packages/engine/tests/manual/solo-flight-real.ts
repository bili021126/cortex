/**
 * solo-flight-real.ts — 最小化真实调用端到端测试
 *
 * 1 Agent + 1 任务。验证 Core-2 管道在真实 LLM 中激活。
 * 用法: npx tsx tests/manual/solo-flight-real.ts
 * ⚠️ 最多 2 个 Agent 实例（MetaAgent + CodeAgent）
 */

import { PipelinePriority } from "@cortex/shared";
import { bootstrapEngine } from "@cortex/engine";
import { e2eBootstrap, log } from "./e2e/e2e-utils.js";
import * as path from "node:path";

async function main() {
  const { root, llm, toolkit } = e2eBootstrap();
  log("🚀 Cortex Solo Flight\n");
  log("📦 Bootstrap...");
  const engine = await bootstrapEngine(root, {
    llms: new Map([["default", llm]]), toolkit,
    dbPath: path.join(root, ".cortex", "test", "solo-flight.db"),
  } as any);
  log("✅ OK");
  try { (toolkit as any).gate?.bypassAll?.(); log("🔓 Gate bypass"); } catch { /* nop */ }

  for (const [n, v] of [["TaskRouter", engine.taskRouter], ["Sentinel", engine.sentinelFilter], ["NotifyRt", engine.notificationRuntime], ["Bridge", engine.decisionBridge], ["GovEmit", engine.governanceEmitter], ["EnvRt", engine.envRouter]] as [string, unknown][])
    log(`   ${v ? "✅" : "⚠️"} ${n}`);

  const events: string[] = [];
  engine.observer.on(PipelinePriority.HIGH, (e) => events.push(e.type as string));

  log("\n🧠 甘雨规划...");
  if (!engine.metaAgent) { log("❌ no MetaAgent"); await engine.shutdown(); return; }
  const nodes = await engine.metaAgent.plan("在 packages/engine/src/core/ 创建 health.ts，导出 checkHealth() 返回 { ok: true }。使用 write_file 写入。");
  log(`   ${nodes.length} nodes`);
  if (!nodes.length) { await engine.shutdown(); return; }

  for (const n of nodes) engine.board.addNode(n);
  log("⚡ Execute...");
  const rpt = await engine.scheduler.executeAll();
  for (const r of rpt.results) log(`   ${r.success ? "✅" : "❌"} ${r.agentType}: ${(r.output ?? "").slice(0, 80)}`);
  log(`\n📊 ${rpt.completed} ok | events: ${events.length}`);

  await engine.shutdown();
  log("✨ Done");
}
main().catch((e) => { log(`💥 ${e}`); process.exit(1); });
