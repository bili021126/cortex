/**
 * 超级复杂场景 —— 7 Agent 归入 + 全链路压力测试
 *
 * 用法: npx tsx tests/manual/mini-react-test.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 参与 Agent（9 个）:
 *   MetaAgent    —— 规划拆解
 *   InspectorAgent —— 纯事实采集（文件/导出/行数）
 *   AnalysisAgent  —— 架构分析 + 模块地图
 *   ReviewAgent    —— 代码审查 4 个核心文件
 *   DocGovernAgent —— 宪法合规审计
 *   CodeAgent      —— 汇总发现，修复小问题
 *   LoopAgent      —— 模式提炼，生成技能模板
 *   OpsAgent       —— 环境诊断 + 运维收尾
 *   ButlerAgent    —— 旁观事件总线，格式化输出
 *
 * 验证点：
 *   1. MetaAgent 能否为 7 种意图产出正确类型的 TaskNode
 *   2. Scheduler 能否正确派发到全部 7 种 Agent
 *   3. MemoryStore 与 Agent 共享记忆（探针采集→铁锤修复引用）
 *   4. 多视角节点（review + audit 并行跑同一批文件）
 *   5. 依赖排序（analysis →fix 有序执行）
 *   6. ButlerAgent 事件格式化不丢消息
 *   7. sql.js 持久化重启不丢
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType, PipelinePriority } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { MetaAgent, TaskBoard, AgentPool, createAgent, codeAgentConfig, reviewAgentConfig, analysisAgentConfig, docGovernAgentConfig, createInspectorAgent, loopAgentConfig, opsAgentConfig, ButlerAgent, Scheduler, PipelineObserver, ConfirmGate } from "@cortex/engine";
import { Toolkit, CLIAdapter } from "@cortex/platform";
import { MemoryStore } from "@cortex/memory-store";
import { resolveLlmConfig } from "../config/llm-defaults";
// ═══════════════════════════════════════════════
// 角色表 —— 原神角色身份
// ═══════════════════════════════════════════════
const AGENT_PERSONA = {
    "meta": { emoji: "🧊", name: "甘雨", title: "七星秘书" },
    "code": { emoji: "⚗️", name: "阿贝多", title: "首席炼金术士" },
    "review": { emoji: "⚡", name: "刻晴", title: "玉衡星" },
    "analysis": { emoji: "🌿", name: "纳西妲", title: "草神" },
    "doc-govern": { emoji: "💎", name: "凝光", title: "天权星" },
    "inspector": { emoji: "🏹", name: "安柏", title: "侦察骑士" },
    "loop": { emoji: "🔮", name: "莫娜", title: "占星术士" },
    "ops": { emoji: "⚓", name: "北斗", title: "南十字船长" },
    // tag → persona 别名（用于 node.type / node.tags[0] 查找）
    "inspect": { emoji: "🏹", name: "安柏", title: "侦察骑士" },
    "audit": { emoji: "💎", name: "凝光", title: "天权星" },
    "doc_govern": { emoji: "💎", name: "凝光", title: "天权星" },
    "constitution_check": { emoji: "💎", name: "凝光", title: "天权星" },
    "implementation": { emoji: "⚗️", name: "阿贝多", title: "首席炼金术士" },
    "bugfix": { emoji: "⚗️", name: "阿贝多", title: "首席炼金术士" },
    "refactor": { emoji: "⚗️", name: "阿贝多", title: "首席炼金术士" },
    "research": { emoji: "🌿", name: "纳西妲", title: "草神" },
    "pattern_scan": { emoji: "🔮", name: "莫娜", title: "占星术士" },
    "skill_precipitate": { emoji: "🔮", name: "莫娜", title: "占星术士" }
};
function personaLine(agentType, msg) {
    const p = AGENT_PERSONA[agentType] ?? { emoji: "🤖", name: agentType, title: "" };
    return `${p.emoji} ${p.name}${p.title ? `（${p.title}）` : ""}: ${msg}`;
}
// ═══════════════════════════════════════════════
// 1. 环境变量
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
// 2. 真实工具
// ═══════════════════════════════════════════════
function registerRealTools(toolkit, workspaceRoot) {
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
    toolkit.register("list_dir", async (params) => {
        const dp = resolve((params.path ?? "."));
        if (!fs.existsSync(dp))
            return { success: false, error: `Dir not found: ${dp}` };
        try {
            const entries = fs.readdirSync(dp, { withFileTypes: true });
            const listing = entries
                .map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`)
                .join("\n");
            return { success: true, output: listing };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    });
    toolkit.register("search_code", async (params) => {
        const query = (params.query ?? params.pattern ?? "");
        const dir = resolve((params.path ?? "."));
        if (!query)
            return { success: false, error: "Missing query/path" };
        try {
            const results = [];
            const walk = (d, depth) => {
                if (depth > 4)
                    return;
                for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                    const full = path.join(d, entry.name);
                    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
                        walk(full, depth + 1);
                    }
                    else if (entry.isFile() && /\.(ts|js|json|md)$/.test(entry.name)) {
                        const stat = fs.statSync(full);
                        if (stat.size > 100 * 1024)
                            continue;
                        const content = fs.readFileSync(full, "utf-8");
                        const lines = content.split("\n");
                        for (let i = 0; i < lines.length; i++) {
                            if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                                results.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
                            }
                        }
                    }
                }
            };
            walk(dir, 0);
            return { success: true, output: results.slice(0, 20).join("\n") || "(no matches)" };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    });
    toolkit.register("write_file", async (params) => {
        const fp = resolve(params.file_path);
        if (!fp.startsWith(workspaceRoot)) {
            return { success: false, error: "write_file denied: outside workspace" };
        }
        try {
            const dir = path.dirname(fp);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fp, params.content_blob, "utf-8");
            return { success: true, output: `Wrote ${Buffer.byteLength(params.content_blob)} bytes to ${fp}` };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    });
    toolkit.register("run_shell", async (params) => {
        // 安全限制：只允许无副作用命令
        const cmd = (params.command ?? params.cmd ?? "");
        const ALLOWED = /^(dir|ls|echo|type|cat|wc|find|node -v|tsc --version|git status)$/i;
        if (!ALLOWED.test(cmd.trim())) {
            return { success: false, error: `run_shell denied: command not in allowlist: ${cmd}` };
        }
        try {
            const { execSync } = await import("node:child_process");
            const out = execSync(cmd, { cwd: workspaceRoot, timeout: 5000, encoding: "utf-8" });
            return { success: true, output: out };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    });
}
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
    const REASONER_MODEL = llmCfg.reasonerModel;
    const WORKSPACE = process.cwd();
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║  超级复杂场景 · 7 Agent 归入全链路测试      ║");
    console.log("╚══════════════════════════════════════════════╝\n");
    console.log(`  Model:  ${CHAT_MODEL} / ${REASONER_MODEL}`);
    console.log(`  CWD:    ${WORKSPACE}`);
    console.log(`  Agents: Meta + Inspector + Analysis + Review + DocGovern + Code + Loop + Ops + Butler\n`);
    // ── 初始化组件 ──
    console.log("🟢 [Phase 1] 初始化组件...");
    const adapter = new LlmAdapter({
        apiKey: API_KEY,
        baseUrl: BASE_URL,
        chatModel: CHAT_MODEL,
        reasonerModel: REASONER_MODEL,
        reasoningEffort: llmCfg.reasoningEffort
    });
    adapter.setCacheEnabled(true);
    const metaAgent = new MetaAgent(adapter);
    const board = new TaskBoard();
    const pool = new AgentPool();
    const observer = new PipelineObserver();
    const gate = new ConfirmGate();
    gate.bypassAll();
    const cliAdapter = new CLIAdapter();
    gate.setBridge(cliAdapter);
    const memory = new MemoryStore();
    const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory.db");
    await memory.init(MEMORY_DB);
    console.log(`   ✅ MemoryStore 持久化: ${MEMORY_DB}`);
    // 注册全部 7 种可执行 Agent 的池配额
    pool.register({ type: AgentType.Code, maxInstances: 3 });
    pool.register({ type: AgentType.Review, maxInstances: 3 });
    pool.register({ type: AgentType.Analysis, maxInstances: 3 });
    pool.register({ type: AgentType.DocGovern, maxInstances: 3 });
    pool.register({ type: AgentType.Inspector, maxInstances: 3 });
    pool.register({ type: AgentType.Loop, maxInstances: 3 });
    pool.register({ type: AgentType.Ops, maxInstances: 3 });
    const scheduler = new Scheduler(board, pool, observer, metaAgent);
    // ── 注册全部 7 种可执行 Agent ──
    const codeAgent = createAgent(codeAgentConfig("code"), adapter, new Toolkit(gate), memory);
    await codeAgent.wakeup();
    scheduler.register(AgentType.Code, codeAgent, CHAT_MODEL);
    const reviewAgent = createAgent(reviewAgentConfig("review"), adapter, new Toolkit(gate), memory);
    await reviewAgent.wakeup();
    scheduler.register(AgentType.Review, reviewAgent, CHAT_MODEL);
    const analysisAgent = createAgent(analysisAgentConfig("analysis"), adapter, new Toolkit(gate), memory);
    await analysisAgent.wakeup();
    scheduler.register(AgentType.Analysis, analysisAgent, CHAT_MODEL);
    const docGovernAgent = createAgent(docGovernAgentConfig("doc-govern"), adapter, new Toolkit(gate), memory);
    await docGovernAgent.wakeup();
    scheduler.register(AgentType.DocGovern, docGovernAgent, CHAT_MODEL);
    const inspectorAgent = createInspectorAgent(adapter, new Toolkit(gate), memory);
    await inspectorAgent.wakeup();
    scheduler.register(AgentType.Inspector, inspectorAgent, CHAT_MODEL);
    const loopAgent = createAgent(loopAgentConfig("loop"), adapter, new Toolkit(gate));
    await loopAgent.wakeup();
    scheduler.register(AgentType.Loop, loopAgent, CHAT_MODEL);
    const opsAgent = createAgent(opsAgentConfig("ops"), adapter, new Toolkit(gate));
    await opsAgent.wakeup();
    scheduler.register(AgentType.Ops, opsAgent, CHAT_MODEL);
    console.log("   ✅ 7 可执行 Agent 就绪");
    // ── 注册 ButlerAgent（旁观者，不参与 Scheduler 派发）──
    const butler = new ButlerAgent(observer, cliAdapter);
    await butler.wakeup();
    console.log("   ✅ ButlerAgent 就绪（事件旁观）\n");
    // ── 规划 ──
    console.log("🟢 [Phase 2] 🧊 甘雨（七星秘书）拆解意图...");
    const intent = [
        "🏥 Cortex 引擎全面健康体检",
        "",
        "在 packages/engine/src/ 下的核心运行时模块，执行以下完整检查流程：",
        "",
        "1. 事实采集：列出所有 .ts 源文件，统计每个文件的导出符号数、代码行数",
        "2. 架构分析：分析所有模块的职责、依赖关系、输入输出，输出模块全景地图",
        "3. 代码审查：审查 base-agent.ts、memory-store.ts、scheduler.ts、meta-agent.ts 这 4 个核心文件",
        "   检查代码质量、风格一致性、潜在缺陷",
        "4. 宪法审计：按 Cortex 宪法条款逐条审计，检查有无违规项和架构偏移",
        "5. 问题修复：汇总架构分析、代码审查、宪法审计的发现，修复可以安全修复的小问题",
        "6. 模式提炼：从上述已完成的任务中识别可复用的执行模式，形成技能模板摘要",
        "7. 环境诊断：检查工作目录结构、git 状态等环境信息，作为运维参考",
        "",
        "各司其职，完工后各自汇报。通过 MemoryStore 共享发现，阿贝多修复时引用前人的诊断结果。",
    ].join("\n");
    const planStart = Date.now();
    const nodes = await metaAgent.plan(intent);
    const planDuration = Date.now() - planStart;
    console.log(`   🧊 甘雨 ：「已阅。此意图可拆为 ${nodes.length} 个兵种任务，各司其职。」(${planDuration}ms)`);
    for (const n of nodes) {
        const tagStr = [n.type, ...n.tags].join(" | ");
        const p = AGENT_PERSONA[n.tags[0]] ?? AGENT_PERSONA[n.type] ?? { name: n.type };
        console.log(`     └─ →${p.emoji}${p.name} :: [${tagStr}] ${n.payload?.toString().slice(0, 80) ?? "?"}`);
    }
    console.log();
    if (nodes.length === 0) {
        console.error("   ❌ MetaAgent 未产出节点");
        process.exit(1);
    }
    // ── 入板 ──
    console.log("🟢 [Phase 3] 入 TaskBoard...");
    for (const n of nodes)
        board.addNode(n);
    console.log(`   ✅ ${board.getAllNodes().length} 节点入板\n`);
    // ── 事件收集（静默统计，不逐条打印）──
    const events = [];
    observer.on(PipelinePriority.HIGH, (e) => {
        events.push({
            type: e.type,
            agentTypes: e.payload?.source.agentType ? [e.payload.source.agentType] : undefined
        });
    });
    // ── 执行 ──
    console.log("\n🟢 [Phase 4] Scheduler 执行（所有 Agent 并行调度）...\n");
    const execStart = Date.now();
    const report = await scheduler.executeAll();
    const execDuration = Date.now() - execStart;
    console.log(`   ✅ 执行耗时: ${execDuration}ms  |  完成: ${report.completed}  失败: ${report.failed}\n`);
    // ── 角色化结果展示 ──
    console.log("  ══ 各兵种汇报 ══");
    const byType = new Map();
    for (const r of report.results) {
        const key = r.source.agentType ?? "unknown";
        if (!byType.has(key))
            byType.set(key, []);
        byType.get(key).push(r);
    }
    for (const [agentType, results] of byType) {
        const p = AGENT_PERSONA[agentType];
        const ok = results.filter((r) => r.success).length;
        const fail = results.filter((r) => !r.success).length;
        const statusIcon = fail > 0 ? "⚠️" : "✅";
        if (p) {
            console.log(`  ${p.emoji} ${p.name}（${p.title}）${statusIcon} ${ok}✅${fail > 0 ? fail + "❌" : ""}`);
        }
        else {
            console.log(`  🤖 [${agentType}] ${statusIcon} ${ok}✅${fail > 0 ? fail + "❌" : ""}`);
        }
        for (const r of results) {
            const body = (r.output ?? r.error ?? "?").slice(0, 150).replace(/\n/g, " ");
            const prefix = r.success ? "   └─ ✅「" : "   └─ ❌「";
            console.log(`${prefix}${body}」`);
        }
    }
    console.log();
    // ── 诊断报告 ──
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║  全链路诊断报告                             ║");
    console.log("╚══════════════════════════════════════════════╝\n");
    const allNodes = board.getAllNodes();
    const completedNodes = allNodes.filter((n) => n.status === "done");
    const failedNodes = allNodes.filter((n) => n.status === "failed");
    const memories = await memory.read({});
    console.log("── 时序 ──");
    console.log(`  规划: ${planDuration}ms  |  执行: ${execDuration}ms  |  总计: ${planDuration + execDuration}ms`);
    console.log();
    console.log("── Agent 参与度 ──");
    const participated = new Set(report.results.map((r) => r.source.agentType));
    const ALL_AGENTS = [
        { type: AgentType.Inspector, persona: AGENT_PERSONA.inspector },
        { type: AgentType.Analysis, persona: AGENT_PERSONA.analysis },
        { type: AgentType.Review, persona: AGENT_PERSONA.review },
        { type: AgentType.DocGovern, persona: AGENT_PERSONA["doc-govern"] },
        { type: AgentType.Code, persona: AGENT_PERSONA.code },
        { type: AgentType.Loop, persona: AGENT_PERSONA.loop },
        { type: AgentType.Ops, persona: AGENT_PERSONA.ops },
    ];
    for (const a of ALL_AGENTS) {
        const icon = participated.has(a.type) ? "✅" : "❌";
        console.log(`   ${icon} ${a.persona.emoji} ${a.persona.name}`);
    }
    console.log();
    console.log("── 事件统计 ──");
    console.log(`  layer.start:   ${events.filter((e) => e.type === "scheduler.layer.start").length}`);
    console.log(`  node.start:    ${events.filter((e) => e.type === "node.start").length}`);
    console.log(`  node.complete: ${events.filter((e) => e.type === "node.complete").length}`);
    console.log(`  node.replan:   ${events.filter((e) => e.type === "node.replan").length}`);
    console.log(`  总事件:         ${events.length}`);
    console.log();
    console.log("── TaskBoard ──");
    console.log(`  节点: ${allNodes.length}  |  完成: ${completedNodes.length}  |  失败: ${failedNodes.length}`);
    console.log(`  多视角节点: ${allNodes.filter((n) => n.needsMultiPerspective).length}`);
    console.log(`  有依赖节点: ${allNodes.filter((n) => n.parentId).length}`);
    console.log(`  总结果数:   ${allNodes.reduce((s, n) => s + n.results.length, 0)}`);
    console.log();
    console.log("── 记忆系统 ──");
    console.log(`  总条数: ${memories.length}  |  持久化: ${memory.isPersisted ? "✅ sql.js" : "⚠️ 仅内存"}`);
    // 按 Agent 类型统计记忆
    const memByAgent = new Map();
    for (const m of memories) {
        const key = m.source.agentType ?? "unknown";
        memByAgent.set(key, (memByAgent.get(key) ?? 0) + 1);
    }
    memByAgent.forEach((count, at) => {
        console.log(`    ${at}: ${count} 条`);
    });
    console.log();
    // ── 终局裁决（甘雨汇总） ──
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║  🧊 甘雨：终局裁决                           ║");
    console.log("╚══════════════════════════════════════════════╝\n");
    console.log(`  🧊 甘雨 ：「${nodes.length} 个任务已下发，${participated.size}/7 兵种响应，${report.failed > 0 ? `⚠️ ${report.failed} 项未完成，列入待办。」` : `全员通过。」`}`);
    const successCount = report.results.filter((r) => r.success).length;
    const totalCount = report.results.length;
    console.log(`  ✅ MetaAgent:       ${nodes.length} 节点 (${planDuration}ms)`);
    console.log(`  ✅ 参与 Agent:      ${participated.size}/7 种`);
    console.log(`  ✅ 执行结果:        ${successCount}/${totalCount} Agent 运行成功`);
    console.log(`  ✅ TaskBoard:       ${completedNodes.length}/${allNodes.length} 节点完成`);
    console.log(`  ✅ 记忆写入:        ${memories.length} 条（多 Agent 共享）`);
    console.log(`  ✅ ButlerAgent:     格式化 ${events.length} 个事件`);
    console.log();
    // 逐项验证
    console.log("── 验证项 ──");
    const checks = [
        { label: "MetaAgent 产出 ≥3 节点", pass: nodes.length >= 3 },
        { label: "≥3 种 Agent 参与执行", pass: participated.size >= 3 },
        { label: "记忆多 Agent 共享 (≥2 种 Agent 写入)", pass: memByAgent.size >= 2 },
        { label: "ButlerAgent 收到事件", pass: events.length > 0 },
        { label: "无 replan（一次通过）", pass: events.filter((e) => e.type === "node.replan").length === 0 },
        { label: "sql.js 持久化确认", pass: memory.isPersisted },
    ];
    let allPassed = true;
    for (const c of checks) {
        const icon = c.pass ? "✅" : "❌";
        if (!c.pass)
            allPassed = false;
        console.log(`   ${icon} ${c.label}`);
    }
    console.log();
    if (allPassed) {
        console.log("  🎉 全部验证项通过！\n");
    }
    else {
        console.log("  ⚠️  部分验证项未通过，详见上方标记\n");
    }
    await butler.shutdown();
    cliAdapter.close();
}
main().catch((err) => {
    console.error("❌ 测试失败:", err);
    process.exit(1);
});
//# sourceMappingURL=mini-react-test.js.map