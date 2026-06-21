/**
 * cortex-e2e-full.ts —— 宪法 v3.0 全量真实 E2E
 *
 * 浓缩凝练自 14 个旧 e2e 测试。使用 e2e-utils.ts 共享工具。
 *
 * 用法: npx tsx packages/engine/tests/manual/e2e/cortex-e2e-full.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * ⚠️ 最多 2 个 Agent 实例同时存活。甘雨规划完立即释放。
 */
import { PipelinePriority } from "@cortex/shared";
import { bootstrapEngine } from "@cortex/engine";
import { e2eBootstrap, log } from "./e2e-utils.js";
import * as path from "node:path";
const TASKS = [
    { name: "阿贝多", type: "code", tags: ["code"], payload: "在 packages/engine/src/core/ 下创建 health.ts，导出 checkHealth() 返回 { status: 'ok' }。使用 write_file 写入文件。" },
    { name: "刻晴", type: "review", tags: ["review"], payload: "用 read_file 读取 packages/engine/src/core/health.ts，审查代码质量。不要只描述——必须调用 read_file 然后写结论。" },
    { name: "纳西妲", type: "analysis", tags: ["analysis"], payload: "分析 packages/engine/src/core/ 的模块结构和依赖关系。列出关键发现。" },
    { name: "希格雯", type: "fix", tags: ["fix"], payload: "检查 packages/engine/src/core/health.ts 是否有类型错误或逻辑缺陷。用 read_file 读取，如有问题用 write_file 修复。" },
    { name: "北斗", type: "ops", tags: ["ops"], payload: "用 run_shell 执行 npx tsc --noEmit -p packages/engine/tsconfig.src.json，报告编译结果。" },
    { name: "安柏", type: "inspector", tags: ["inspect"], payload: "用 list_files 采集 packages/engine/src/core/ 下所有 .ts 文件，统计文件数和总行数。" },
    { name: "莫娜", type: "loop", tags: ["loop"], payload: "扫描 skills/ 目录，提取一个可复用的技能模板，用 write_file 输出为 webui/SkillTemplate.json。" },
    { name: "凝光", type: "doc-govern", tags: ["doc-govern"], payload: "检查 docs/constitution/Cortex 概念顶层设计 v3.0.md 是否存在并确认结构完整。" },
    { name: "久岐忍", type: "api", tags: ["api"], payload: "设计 health-check API 端点规范，用 write_file 输出为 docs/api/api-spec.md。" },
];
// ── 主流程 ──────────────────────────────────
async function main() {
    const { root, llm, toolkit } = e2eBootstrap();
    log("🏛️  Cortex v3.0 宪法全量 E2E\n");
    // Bootstrap
    log("📦 Bootstrap 引擎...");
    const engine = await bootstrapEngine(root, {
        llms: new Map([["default", llm]]),
        toolkit,
        dbPath: path.join(root, ".cortex", "test", "e2e-full.db"),
    });
    log("✅ Bootstrap 完成");
    // E2E 测试环境：绕过 ConfirmGate
    try {
        toolkit.gate?.bypassAll?.();
        log("🔓 ConfirmGate bypass");
    }
    catch { /* 不可用 */ }
    // Core-2 组件检查
    log("✅ Core-2 管道:");
    for (const [name, val] of [["TaskRouter", engine.taskRouter], ["SentinelFilter", engine.sentinelFilter], ["NotificationRt", engine.notificationRuntime], ["DecisionBridge", engine.decisionBridge], ["GovernanceEmit", engine.governanceEmitter], ["EnvRouter", engine.envRouter]]) {
        log(`   ${val ? "✅" : "⚠️"} ${name}`);
    }
    // 事件收集
    const events = [];
    engine.observer.on(PipelinePriority.HIGH, (e) => events.push(e.type));
    // 甘雨规划
    log("\n🧠 甘雨规划...");
    if (!engine.metaAgent) {
        log("❌ MetaAgent 未初始化");
        await engine.shutdown();
        return;
    }
    let planNodes;
    try {
        planNodes = await engine.metaAgent.plan("逐一执行以下任务，每个任务必须使用对应工具（write_file/read_file/run_shell/list_files）：" + TASKS.map((t, i) => `${i + 1}.${t.payload}`).join(" "));
    }
    catch (e) {
        log(`❌ 甘雨规划失败: ${e}`);
        await engine.shutdown();
        return;
    }
    log(`   ${planNodes.length} 个节点`);
    for (const n of planNodes)
        log(`     - ${n.type} [${n.tags.join(",")}] ${n.payload.slice(0, 55)}...`);
    if (planNodes.length === 0) {
        log("⚠️ 甘雨拒绝规划");
        await engine.shutdown();
        return;
    }
    // 逐个执行
    let passed = 0, failed = 0;
    for (let i = 0; i < planNodes.length; i++) {
        const node = planNodes[i];
        log(`\n⚡ [${i + 1}/${planNodes.length}] ${node.type}: ${node.payload.slice(0, 60)}...`);
        const board = engine.board;
        board.addNode(node);
        const start = Date.now();
        const report = await engine.scheduler.executeAll();
        const elapsed = Date.now() - start;
        for (const r of report.results) {
            if (r.success)
                passed++;
            else
                failed++;
            log(`   ${r.success ? "✅" : "❌"} ${r.agentType}: ${(r.output ?? r.error ?? "").slice(0, 100)}`);
        }
        if (report.results.length === 0) {
            const n = board.getNode(node.id);
            log(`   ⚠️ 无结果——状态: ${n?.status ?? "?"}`);
        }
        log(`   ⏱️ ${elapsed}ms`);
    }
    // 汇总
    log(`\n═══════════════════════════════════`);
    log(`📊 ${passed} pass / ${failed} fail / ${passed + failed} total`);
    log(`📊 管道事件: ${events.length} 个`);
    const gov = events.filter((e) => e.startsWith("governance") || e.includes("sentinel") || e.includes("notification"));
    log(`📊 治理事件: ${gov.length} 个`);
    await engine.shutdown();
    log("\n✨ 宪法 v3.0 首次 E2E 完成");
}
main().catch((e) => { log(`💥 ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
//# sourceMappingURL=cortex-e2e-full.js.map