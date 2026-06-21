/**
 * e2e-minimal.ts —— 最简端到端验证：1个计划 + 1个Agent + 1次write_file
 * 用法: npx tsx packages/engine/tests/manual/e2e/e2e-minimal.ts
 */
import * as path from "node:path";
import * as fs from "node:fs";
import { PipelinePriority } from "@cortex/shared";
import { bootstrapEngine } from "@cortex/engine";
import { e2eBootstrap, log } from "./e2e-utils.js";
const TARGET = "packages/engine/src/core/_e2e_test.ts";
const TARGET_CONTENT = "// e2e-minimal auto-generated\nexport const e2e = true;\n";
async function main() {
    const { root, llm, toolkit } = e2eBootstrap();
    log("⚡ e2e-minimal\n");
    // Bootstrap
    const db = path.join(root, ".cortex", "test", "e2e-minimal.db");
    const engine = await bootstrapEngine(root, { llms: new Map([["default", llm]]), toolkit, dbPath: db });
    log("✅ Bootstrap");
    try {
        toolkit.gate?.bypassAll?.();
    }
    catch { /* */ }
    // Events
    const events = [];
    engine.observer.on(PipelinePriority.HIGH, (e) => events.push(e.type ?? ""));
    // Plan
    if (!engine.metaAgent) {
        log("❌ no MetaAgent");
        await engine.shutdown();
        return;
    }
    log("🧠 Plan...");
    const nodes = await engine.metaAgent.plan(`创建 ${TARGET}，内容为：${TARGET_CONTENT}。直接调用 write_file 写入，不要描述。`);
    log(`   ${nodes.length} nodes`);
    for (const n of nodes)
        log(`     ${n.type} [${n.tags}] ${n.payload?.slice(0, 60)}`);
    if (!nodes.length) {
        await engine.shutdown();
        return;
    }
    // Execute
    for (const n of nodes)
        engine.board.addNode(n);
    log("⚡ Exec...");
    const rpt = await engine.scheduler.executeAll();
    for (const r of rpt.results)
        log(`   ${r.success ? "✅" : "❌"} ${r.agentType}: ${(r.output ?? r.error ?? "").slice(0, 120)}`);
    // Verify
    const fp = path.join(root, TARGET);
    log(`\n📁 ${fp}: ${fs.existsSync(fp) ? "✅ EXISTS" : "❌ ABSENT"}`);
    if (fs.existsSync(fp)) {
        const c = fs.readFileSync(fp, "utf-8");
        log(`   content: ${c.slice(0, 80)}`);
        log(`   match:  ${c.includes("e2e") ? "✅" : "❌"}`);
    }
    log(`\n📊 events: ${events.length}`);
    await engine.shutdown();
    log("done");
}
main().catch(e => { log(`💥 ${e}`); process.exit(1); });
//# sourceMappingURL=e2e-minimal.js.map