/**
 * smoke-write.ts — 最小验证：1个Agent + 1次write_file
 * 用法: npx tsx tests/manual/e2e/smoke-write.ts
 */
import { PipelinePriority } from "@cortex/shared";
import { bootstrapEngine } from "@cortex/engine";
import { e2eBootstrap, log } from "./e2e-utils.js";
import * as path from "node:path";
import * as fs from "node:fs";
async function main() {
    const { root, llm, toolkit } = e2eBootstrap();
    log("🔥 Smoke Write\n");
    log("📦 Bootstrap...");
    const engine = await bootstrapEngine(root, {
        llms: new Map([["default", llm]]),
        toolkit,
        dbPath: path.join(root, ".cortex", "test", "smoke-write.db"),
    });
    log("✅ OK");
    try {
        toolkit.gate?.bypassAll?.();
    }
    catch { /* */ }
    const events = [];
    engine.observer.on(PipelinePriority.HIGH, (e) => events.push(e.type));
    // 甘雨计划
    log("🧠 Plan...");
    if (!engine.metaAgent) {
        log("❌ no MetaAgent");
        await engine.shutdown();
        return;
    }
    const nodes = await engine.metaAgent.plan("创建 packages/engine/src/core/smoke-test.ts 文件，内容为: export const smoke = true;");
    log(`   ${nodes.length} nodes`);
    for (const n of nodes)
        log(`     ${n.type} [${n.tags.join(",")}] ${n.payload.slice(0, 60)}`);
    if (!nodes.length) {
        await engine.shutdown();
        return;
    }
    // 执行
    for (const n of nodes)
        engine.board.addNode(n);
    log("⚡ Execute...");
    const rpt = await engine.scheduler.executeAll();
    for (const r of rpt.results)
        log(`   ${r.success ? "✅" : "❌"} ${r.agentType}: ${(r.output ?? r.error ?? "").slice(0, 150)}`);
    // 验证
    const fp = path.join(root, "packages", "engine", "src", "core", "smoke-test.ts");
    const exists = fs.existsSync(fp);
    log(`\n📁 ${fp}: ${exists ? "✅ EXISTS" : "❌ NOT FOUND"}`);
    if (exists)
        log(`   📝 ${fs.readFileSync(fp, "utf-8").slice(0, 100)}`);
    log(`\n📊 Events: ${events.length}`);
    await engine.shutdown();
    log("\n✨ Done");
}
main().catch((e) => { log(`💥 ${e}`); process.exit(1); });
//# sourceMappingURL=smoke-write.js.map