/**
 * Pipeline 策略路由 E2E —— 真实 LLM 验证 react/direct 策略
 *
 * 用法: npx tsx tests/manual/e2e/pipeline-strategy-e2e.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验证链路:
 *   1. react 策略 → CodeAgent 走 ReAct 循环完成
 *   2. direct 策略 → CodeAgent 走 DirectStep 单次 LLM 调用完成
 *   3. 混合策略共存于同一 dispatch 轮次
 *   4. 两种策略均正确写入记忆
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType, PipelinePriority } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { TaskBoard, AgentPool, Scheduler, PipelineObserver, ConfirmGate, createAgent, codeAgentConfig } from "@cortex/engine";
import { Toolkit } from "@cortex/platform";
import { MemoryStore } from "@cortex/memory-store";
import { resolveLlmConfig } from "../config/llm-defaults";
// ═══════════════════════════════════════════════
// 0. 环境变量
// ═══════════════════════════════════════════════
function loadEnv() {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) {
        console.error("❌ .env 文件不存在");
        process.exit(1);
    }
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
        const clean = line.replace(/\r$/, "");
        const m = clean.match(/^([^=]+)=(.*)$/);
        if (m)
            process.env[m[1]] = m[2].trim();
    }
}
// ═══════════════════════════════════════════════
// 1. 只读工具
// ═══════════════════════════════════════════════
function registerReadOnlyTools(toolkit, workspaceRoot) {
    const resolve = (p) => path.resolve(workspaceRoot, p);
    toolkit.register("read_file", async (params) => {
        const fp = resolve(params.file_path);
        if (!fs.existsSync(fp))
            return { success: false, error: `File not found: ${fp}` };
        try {
            return { success: true, output: fs.readFileSync(fp, "utf-8") };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    });
    const listHandler = async (params) => {
        const dp = resolve((params.dir_path ?? params.path ?? "."));
        if (!fs.existsSync(dp))
            return { success: false, error: `Dir not found: ${dp}` };
        const entries = fs.readdirSync(dp, { withFileTypes: true });
        return {
            success: true,
            output: entries.map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`).join("\n")
        };
    };
    toolkit.register("list_files", listHandler);
    toolkit.register("list_dir", listHandler);
}
// ═══════════════════════════════════════════════
// 2. 辅助
// ═══════════════════════════════════════════════
function makeNode(id, payload, tags = [], strategy) {
    return {
        id,
        type: "code",
        payload,
        tags,
        needsMultiPerspective: false,
        status: "pending",
        claimedBy: [],
        results: [],
        createdAt: Date.now(),
        preferredStrategy: strategy
    };
}
const SEP = "═".repeat(60);
function header(title) { console.log(`\n${SEP}\n  ${title}\n${SEP}`); }
function passed(label) { console.log(`  ✅ ${label}`); }
function failed(label, detail) {
    console.log(`  ❌ ${label}`);
    if (detail)
        console.log(`     ${detail}`);
}
function info(label, value) { console.log(`  📋 ${label}: ${value}`); }
// ═══════════════════════════════════════════════
// 3. 主流程
// ═══════════════════════════════════════════════
async function main() {
    loadEnv();
    const API_KEY = process.env.DEEPSEEK_API_KEY;
    if (!API_KEY) {
        console.error("❌ DEEPSEEK_API_KEY 未设置");
        process.exit(1);
    }
    const llmCfg = resolveLlmConfig();
    const BASE_URL = llmCfg.baseUrl;
    const CHAT_MODEL = llmCfg.chatModel;
    const WORKSPACE = process.cwd();
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  🔀 Pipeline 策略路由 E2E — react vs direct      ║");
    console.log("╚══════════════════════════════════════════════════╝\n");
    console.log(`  Model: ${CHAT_MODEL}`);
    console.log(`  CWD:   ${WORKSPACE}\n`);
    let allPassed = true;
    // ── Phase 1: 基础设施 ──
    header("Phase 1/3 — 初始化基础设施");
    const adapter = new LlmAdapter({
        apiKey: API_KEY,
        baseUrl: BASE_URL,
        chatModel: CHAT_MODEL,
        reasonerModel: CHAT_MODEL
    });
    adapter.setCacheEnabled(true);
    const board = new TaskBoard();
    const pool = new AgentPool();
    const observer = new PipelineObserver();
    const gate = new ConfirmGate();
    gate.bypassAll();
    const memory = new MemoryStore();
    const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-pipeline-strategy.db");
    await memory.init(MEMORY_DB);
    info("MemoryStore", MEMORY_DB);
    pool.register({ type: AgentType.Code, maxInstances: 2 });
    const scheduler = new Scheduler(board, pool, observer);
    // ── Phase 2: 注册 Agent ──
    header("Phase 2/3 — 注册 CodeAgent");
    const toolkit = new Toolkit(gate);
    registerReadOnlyTools(toolkit, WORKSPACE);
    const agent = createAgent(codeAgentConfig("pipeline-e2e"), adapter, toolkit, memory);
    await agent.wakeup();
    scheduler.register(AgentType.Code, agent, CHAT_MODEL);
    // 事件监听
    observer.on(PipelinePriority.HIGH, (e) => {
        const p = e.payload;
        const id = p?.nodeId ? `[${String(p.nodeId).slice(0, 20)}]` : "";
        if (e.type === "node.complete") {
            console.log(`   ✅ ${id} ${p.source.agentType ?? "?"} 完成 (strategy: ${p.strategy ?? "?"})`);
        }
        else if (e.type === "node.failed") {
            console.log(`   ❌ ${id} 失败: ${String(p.error ?? "").slice(0, 120)}`);
        }
    });
    passed("CodeAgent 就绪");
    // ── Phase 3: 策略路由验证 ──
    header("Phase 3/3 — 策略路由验证");
    // Test 1: react 策略
    console.log("\n  ── Test 1: react 策略 ──");
    board.addNode(makeNode("react-1", "Read packages/engine/package.json and tell me the package name. Reply in 1 sentence.", ["code"], "react"));
    const r1 = await scheduler.executeAll();
    const n1 = board.getNode("react-1");
    if (n1.status === "done" && n1.results[0]?.success) {
        passed("react 策略完成");
        info("输出", (n1.results[0].output ?? "").slice(0, 120));
    }
    else {
        failed("react 策略", n1.results[0]?.error ?? `status=${n1.status}`);
        allPassed = false;
    }
    // Test 2: direct 策略
    console.log("\n  ── Test 2: direct 策略 ──");
    board.addNode(makeNode("direct-1", "What is 2+2? Reply with just the number.", ["code"], "direct"));
    const r2 = await scheduler.executeAll();
    const n2 = board.getNode("direct-1");
    if (n2.status === "done" && n2.results[0]?.success) {
        passed("direct 策略完成");
        info("输出", (n2.results[0].output ?? "").slice(0, 120));
    }
    else {
        failed("direct 策略", n2.results[0]?.error ?? `status=${n2.status}`);
        allPassed = false;
    }
    // Test 3: 混合策略同一轮 dispatch
    console.log("\n  ── Test 3: 混合策略共存 ──");
    board.addNode(makeNode("mix-react", "Read packages/engine/src/index.ts and list 3 exported symbols. Reply concisely.", ["code"], "react"));
    board.addNode(makeNode("mix-direct", "What is the capital of France? Reply with just the city name.", ["code"], "direct"));
    const r3 = await scheduler.executeAll();
    const nMix1 = board.getNode("mix-react");
    const nMix2 = board.getNode("mix-direct");
    const mix1Ok = nMix1.status === "done" && nMix1.results[0]?.success;
    const mix2Ok = nMix2.status === "done" && nMix2.results[0]?.success;
    if (mix1Ok)
        passed("react 节点完成");
    else {
        failed("react 节点", nMix1.results[0]?.error ?? `status=${nMix1.status}`);
        allPassed = false;
    }
    if (mix2Ok)
        passed("direct 节点完成");
    else {
        failed("direct 节点", nMix2.results[0]?.error ?? `status=${nMix2.status}`);
        allPassed = false;
    }
    // ── Test 4: 记忆写入验证 ──
    console.log("\n  ── Test 4: 记忆写入 ──");
    // 使用大 limit 确保不被默认 limit=3 截断（4 个任务×2 条=8 条记忆）
    const allMem = await memory.read({ limit: 100 });
    const pendingMems = memory.getPending();
    if (pendingMems.length > 0) {
        console.log(`  📊 残留 Pending: ${pendingMems.length} 条`);
    }
    const reactMems = allMem.filter((m) => m.content_blob?.taskId === "react-1" && m.kind === "TaskLog");
    const directMems = allMem.filter((m) => m.content_blob?.taskId === "direct-1" && m.kind === "TaskLog");
    if (reactMems.length >= 1)
        passed(`react 策略写入记忆: ${reactMems.length} 条`);
    else {
        failed("react 策略未写入记忆");
        allPassed = false;
    }
    if (directMems.length >= 1)
        passed(`direct 策略写入记忆: ${directMems.length} 条`);
    else {
        failed("direct 策略未写入记忆");
        allPassed = false;
    }
    // ── 诊断 ──
    console.log("\n  ── TaskBoard 诊断 ──");
    const allNodes = board.getAllNodes();
    const doneNodes = allNodes.filter((n) => n.status === "done");
    const failedNodes = allNodes.filter((n) => n.status === "failed");
    info("总节点", `${allNodes.length} (done=${doneNodes.length}, failed=${failedNodes.length})`);
    info("总记忆", `${allMem.length} 条`);
    for (const n of allNodes) {
        const icon = n.status === "done" ? "✅" : "❌";
        const strategy = n.preferredStrategy ?? "default";
        console.log(`   ${icon} [${strategy}] ${n.id}: ${(n.results[0]?.output ?? "").slice(0, 100)}`);
    }
    // ── 收尾 ──
    await memory.close();
    console.log(`\n${SEP}`);
    if (allPassed) {
        console.log("  ✅ Pipeline 策略路由 E2E 全部通过");
    }
    else {
        console.log("  ❌ Pipeline 策略路由 E2E 存在问题");
    }
    console.log(`${SEP}\n`);
    if (!allPassed)
        process.exit(1);
}
main().catch((err) => {
    console.error("💥 E2E 崩溃:", err);
    process.exit(1);
});
//# sourceMappingURL=pipeline-strategy-e2e.js.map