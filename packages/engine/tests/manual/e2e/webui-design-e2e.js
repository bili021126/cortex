/**
 * 宵宫视觉设计闭环 E2E —— CodeAgent + BrowserAgent + FixAgent 三 Agent 协作
 *
 * 场景：设计一个复杂的管理后台 Dashboard UI（纯 HTML + CSS，无框架）
 *
 * 用法: npx tsx tests/manual/e2e/webui-design-e2e.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验证点：
 *   1. 阿贝多能否根据设计需求写出结构完整的 HTML+CSS
 *   2. 宵宫能否用 browser_do (navigate/screenshot/evaluate/measure) 做视觉审查
 *   3. 宵宫能否指出具体的视觉问题（间距、颜色、对齐等）
 *   4. 希格雯能否根据宵宫的反馈修复
 *   5. 闭环：修复后宵宫再审查 → 通过或继续迭代（最多 3 轮）
 *
 * 参与 Agent:
 *   CodeAgent (阿贝多)   —— 写 HTML+CSS
 *   BrowserAgent (宵宫)  —— navigate → screenshot → evaluate → 视觉反馈
 *   FixAgent (希格雯)    —— 接收反馈 → 修复
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType, PipelinePriority } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { TaskBoard, AgentPool, createAgent, codeAgentConfig, fixAgentConfig, createBrowserAgent, Scheduler, PipelineObserver, ConfirmGate, MetaAgent, } from "@cortex/engine";
import { Toolkit, LocalTool } from "@cortex/platform";
import { MemoryStore } from "@cortex/memory-store";
import { resolveLlmConfig } from "../config/llm-defaults";
import { ToolCategory, ReversibilityLevel } from "@cortex/shared";
// ═══════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════
const OUTPUT_DIR = path.resolve(process.cwd(), "test-output", "webui-demo");
const HTML_OUTPUT = path.join(OUTPUT_DIR, "dashboard.html");
const MAX_DESIGN_ROUNDS = 3;
const DESIGN_BRIEF = `设计一个「项目管理后台 Dashboard」页面，要求：

## 功能模块
1. 左侧边栏（深色）：Logo + 导航菜单（仪表盘/项目/任务/成员/设置），当前激活"仪表盘"
2. 顶部栏（白色）：搜索框 + 通知铃铛（红色数字角标3）+ 用户头像
3. 统计卡片行（4个）：项目总数 128 / 进行中 36 / 已完成 89 / 逾期 3，带图标和趋势箭头
4. 任务列表表格：列（任务名/负责人/状态/截止日期/优先级），至少 5 行假数据，状态用彩色标签
5. 最近活动时间线：左侧竖线 + 圆点，5 条活动记录
6. 底部状态栏：显示连接状态/最后同步时间

## 视觉要求
- 侧边栏宽 240px，深色背景 #1a1a2e
- 主内容区浅灰背景 #f5f6fa
- 卡片白色背景，圆角 12px，box-shadow
- 统计卡片内的数字要大号加粗（28px）
- 表格斑马纹（奇数行 #fafbfc）
- 优先级用颜色区分：高=#e74c3c / 中=#f39c12 / 低=#27ae60
- 状态标签：进行中=蓝色、已完成=绿色、待开始=灰色
- 整体字体：系统默认 -apple-system, sans-serif

## 约束
- 纯 HTML + 内联 CSS（写在 <style> 标签中），不使用任何框架
- 使用 CSS Grid 做主布局（侧边栏 + 右区域）
- 使用 Flexbox 做卡片行、表格等内部布局
- 所有颜色、间距必须精确匹配上述规范
- 输出完整可独立打开的 .html 文件`;
// ═══════════════════════════════════════════════
// 角色表
// ═══════════════════════════════════════════════
const PERSONA = {
    "code": { emoji: "🧪", name: "阿贝多" },
    "browser": { emoji: "🎆", name: "宵宫" },
    "fix": { emoji: "💉", name: "希格雯" },
    "meta": { emoji: "📋", name: "甘雨" },
};
function p(agentType, msg) {
    const a = PERSONA[agentType] ?? { emoji: "🤖", name: agentType };
    return `${a.emoji} ${a.name}: ${msg}`;
}
// ═══════════════════════════════════════════════
// 1. 环境 & 工具注册
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
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
function registerWebuiTools(toolkit, projectRoot) {
    const resolve = (p) => {
        if (path.isAbsolute(p))
            return p;
        return path.resolve(projectRoot, p);
    };
    // read_file —— 带完整 schema
    toolkit.registerTool(new LocalTool("read_file", ToolCategory.Read, "Read the contents of a file at the given path.", {
        type: "object",
        properties: {
            file_path: { type: "string", description: "Absolute path to file" },
        },
        required: ["file_path"],
    }, ReversibilityLevel.L0, async (params) => {
        const fp = resolve((params.file_path ?? params.path));
        if (!fp)
            return { success: false, error: "read_file: 缺少 file_path 参数" };
        if (!fs.existsSync(fp))
            return { success: false, error: `File not found: ${fp}` };
        try {
            return { success: true, output: fs.readFileSync(fp, "utf-8") };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    }));
    // write_file —— 带完整 schema
    toolkit.registerTool(new LocalTool("write_file", ToolCategory.Write, "Write content to a file at the given path.", {
        type: "object",
        properties: {
            file_path: { type: "string", description: "Absolute path to file" },
            content: { type: "string", description: "Content to write" },
        },
        required: ["file_path", "content"],
    }, ReversibilityLevel.L2, async (params) => {
        const fp = resolve((params.file_path ?? params.path));
        const content = (params.content ?? params.content_blob ?? params.data ?? "");
        if (!fp)
            return { success: false, error: "write_file: 缺少 file_path 参数" };
        if (!content)
            return { success: false, error: "write_file: 缺少 content 参数" };
        try {
            const dir = path.dirname(fp);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fp, content, "utf-8");
            return { success: true, output: `已写入 ${fp} (${content.length} 字符)` };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    }));
    // list_files / list_dir —— 带完整 schema
    const listHandler = async (params) => {
        const dp = resolve((params.dir_path ?? params.path ?? "."));
        if (!fs.existsSync(dp))
            return { success: false, error: `Dir not found: ${dp}` };
        try {
            const entries = fs.readdirSync(dp, { withFileTypes: true });
            const listing = entries.map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`).join("\n");
            return { success: true, output: listing };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    };
    toolkit.registerTool(new LocalTool("list_files", ToolCategory.Read, "List files and directories in a given path.", {
        type: "object",
        properties: {
            dir_path: { type: "string", description: "Path to directory" },
        },
        required: ["dir_path"],
    }, ReversibilityLevel.L0, listHandler));
    toolkit.registerTool(new LocalTool("list_dir", ToolCategory.Read, "List files and directories in a given path.", {
        type: "object",
        properties: {
            dir_path: { type: "string", description: "Path to directory" },
        },
        required: ["dir_path"],
    }, ReversibilityLevel.L0, listHandler));
    // search_code —— 带完整 schema
    toolkit.registerTool(new LocalTool("search_code", ToolCategory.Search, "Search for a text pattern in files within a directory.", {
        type: "object",
        properties: {
            query: { type: "string", description: "Text pattern to search for" },
            path: { type: "string", description: "Directory to search in" },
        },
        required: ["query"],
    }, ReversibilityLevel.L0, async (params) => {
        const query = (params.query ?? params.pattern ?? "");
        const dir = resolve((params.path ?? "."));
        if (!query)
            return { success: false, error: "Missing query/pattern" };
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
                    else if (entry.isFile() && /\.(html|css|ts|js|json|md)$/.test(entry.name)) {
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
    }));
}
// ═══════════════════════════════════════════════
// 2. 引导
// ═══════════════════════════════════════════════
async function main() {
    loadEnv();
    ensureDir(OUTPUT_DIR);
    const API_KEY = process.env.DEEPSEEK_API_KEY;
    if (!API_KEY) {
        console.error("❌ DEEPSEEK_API_KEY 未设置");
        process.exit(1);
    }
    const llmCfg = resolveLlmConfig();
    const BASE_URL = llmCfg.baseUrl;
    const CHAT_MODEL = llmCfg.chatModel;
    const REASONER_MODEL = llmCfg.reasonerModel;
    console.log(`\n🔧 LLM: ${CHAT_MODEL}`);
    console.log(`📁 输出目录: ${OUTPUT_DIR}\n`);
    // ── 基础设施 ──
    const observer = new PipelineObserver();
    const board = new TaskBoard();
    const pool = new AgentPool();
    const gate = new ConfirmGate();
    gate.bypassAll();
    const llmAdapterConfig = {
        apiKey: API_KEY,
        baseUrl: BASE_URL,
        chatModel: CHAT_MODEL,
        reasonerModel: REASONER_MODEL,
        reasoningEffort: llmCfg.reasoningEffort,
    };
    const llm = new LlmAdapter(llmAdapterConfig);
    llm.setCacheEnabled(true);
    const metaAgent = new MetaAgent(llm);
    // ── 事件监听 ──
    observer.on(PipelinePriority.HIGH, (e) => {
        const payload = e.payload;
        const nodeId = payload?.nodeId ?? "";
        const snippet = JSON.stringify(payload).slice(0, 140);
        console.log(`   📡 ${e.type}: ${nodeId ? nodeId : snippet}`);
    });
    // ── Toolkit ──
    const toolkit = new Toolkit(gate);
    registerWebuiTools(toolkit, OUTPUT_DIR);
    toolkit.setWorkspaceRoot(OUTPUT_DIR);
    // ── MemoryStore ──
    const MEMORY_DB = path.join(OUTPUT_DIR, "memory.db");
    const memory = new MemoryStore();
    await memory.init(MEMORY_DB);
    console.log(`   ✅ MemoryStore: ${MEMORY_DB}`);
    // ── Agent 创建 ──
    // 阿贝多
    const codeSysPrompt = `你是阿贝多，首席炼金术士。专精前端开发，输出精准的高质量 HTML+CSS 代码。
当前工作目录为 test-output/webui-demo/，所有文件读写限定在此目录。
响应需求时直接给出完整代码，不要长篇解释。用 write_file 工具将 HTML 写入 dashboard.html。`;
    const codeAgent = createAgent(codeAgentConfig(codeSysPrompt), llm, toolkit, memory);
    await codeAgent.wakeup();
    // 宵宫
    const browserSysPrompt = `你是宵宫，长野原烟花店店主，也是团队的 UI 视觉设计师。
你的专长是审查页面的视觉质量——布局、间距、颜色、对齐、字体大小。

## 审查流程
1. 用 browser_do navigate 打开 HTML 文件（file:/// 协议）
2. 用 browser_do screenshot（fullPage: true）看全貌
3. 用 browser_do evaluate（expression: "$selector"）检查关键元素的 computed styles
4. 用 browser_do measure 检查具体元素的布局尺寸
5. 对比设计规范，指出问题

## 反馈格式
发现视觉问题时，用以下格式输出：
- **位置**: CSS 选择器
- **现状**: 当前的样式值（如 color: #123456）
- **应为**: 规范要求的样式值（如 color: #1a1a2e）
- **严重度**: 🔴严重 / 🟡建议 / 🟢可忽略

审查完成后，用以下格式给出最终结论：
✓ 设计审查通过
或
✗ 设计审查不通过 — 发现 N 个问题`;
    const browserAgent = createBrowserAgent(llm, toolkit, memory, browserSysPrompt);
    await browserAgent.wakeup();
    // 希格雯
    const fixSysPrompt = `你是希格雯，团队的修复专家。接收宵宫的视觉审查反馈，对照原始 HTML 代码精确定位问题，然后修复 CSS/HTML。
修复后用 write_file 工具将完整修正后的 HTML 写入 dashboard.html。
只改有问题的地方，不要重新设计。`;
    const fixAgent = createAgent(fixAgentConfig(fixSysPrompt), llm, toolkit, memory);
    await fixAgent.wakeup();
    // ── 注册 Agent ──
    pool.register({ type: AgentType.Code, maxInstances: 3 });
    pool.register({ type: AgentType.Browser, maxInstances: 1 });
    pool.register({ type: AgentType.Fix, maxInstances: 2 });
    const scheduler = new Scheduler(board, pool, observer, metaAgent);
    scheduler.register(AgentType.Code, codeAgent, CHAT_MODEL);
    scheduler.register(AgentType.Browser, browserAgent, CHAT_MODEL);
    scheduler.register(AgentType.Fix, fixAgent, CHAT_MODEL);
    scheduler.setMemoryStore(memory);
    // ═══════════════════════════════════════════════
    // 3. Phase 1: 甘雨规划
    // ═══════════════════════════════════════════════
    console.log("═".repeat(60));
    console.log("🎆 宵宫视觉设计闭环测试");
    console.log("═".repeat(60));
    console.log(`\n${p("meta", "开始规划——管理后台 Dashboard 设计任务")}\n`);
    const planNodes = await metaAgent.plan(DESIGN_BRIEF);
    if (planNodes.length === 0) {
        // 甘雨未产出节点 → 手动注入
        const now = Date.now();
        const rootNode = {
            id: `code-${now}`,
            type: "code",
            tags: ["implementation"],
            needsMultiPerspective: false,
            claimedBy: [],
            payload: `${DESIGN_BRIEF}\n\n将完整 HTML 写入 dashboard.html（用 write_file 工具）。`,
            status: "pending",
            results: [],
            createdAt: now,
        };
        board.addNode(rootNode);
        console.log(`   📋 甘雨未产出节点，手动构建任务链`);
    }
    else {
        // Phase 2 只处理 code 类型节点；browser/fix 由 Phase 3 显式编排
        const codeOnly = planNodes.filter(n => n.type === "code" || n.tags?.includes("implementation"));
        const skipped = planNodes.length - codeOnly.length;
        for (const node of codeOnly) {
            board.addNode(node);
        }
        console.log(`   📋 甘雨产出 ${planNodes.length} 个任务节点 → 入队 ${codeOnly.length} 个 code 节点 (跳过 ${skipped} 个非 code 节点)`);
    }
    // ═══════════════════════════════════════════════
    // 4. Phase 2: 阿贝多写代码
    // ═══════════════════════════════════════════════
    console.log(`\n${"─".repeat(60)}`);
    console.log(`${p("code", "开始编写 Dashboard HTML+CSS...")}`);
    console.log(`${"─".repeat(60)}\n`);
    const report1 = await scheduler.executeAll();
    console.log(`\n   ✅ 首轮执行完成: ${report1.completed}/${report1.totalNodes} 成功, ${report1.failed} 失败`);
    // 检查是否有产出文件
    if (!fs.existsSync(HTML_OUTPUT)) {
        const nodes = board.getAllNodes();
        const codeNode = nodes.find(n => n.tags?.includes("implementation") || n.type === "code");
        const codeOutput = codeNode?.results?.[0]?.output;
        if (codeOutput) {
            const htmlMatch = codeOutput.match(/```html\n([\s\S]*?)\n```/) ??
                codeOutput.match(/<html[\s\S]*?<\/html>/);
            if (htmlMatch) {
                fs.writeFileSync(HTML_OUTPUT, htmlMatch[1] ?? htmlMatch[0], "utf-8");
                console.log(`   📄 提取 HTML 保存到: ${HTML_OUTPUT}`);
            }
        }
    }
    // ═══════════════════════════════════════════════
    // 5. Phase 3: 宵宫审查循环（最多 3 轮）
    // ═══════════════════════════════════════════════
    for (let round = 1; round <= MAX_DESIGN_ROUNDS; round++) {
        console.log(`\n${"─".repeat(60)}`);
        console.log(`🎆 审查轮次 ${round}/${MAX_DESIGN_ROUNDS}`);
        console.log(`${"─".repeat(60)}\n`);
        if (!fs.existsSync(HTML_OUTPUT)) {
            console.log(`   ⚠️ HTML 文件不存在，跳过审查`);
            break;
        }
        const fileUrl = `file:///${HTML_OUTPUT.replace(/\\/g, "/")}`;
        const reviewNode = {
            id: `review-r${round}`,
            type: "browser",
            tags: ["browser"],
            needsMultiPerspective: false,
            claimedBy: [],
            payload: [
                DESIGN_BRIEF,
                "",
                "## 你的任务",
                "审查当前 HTML 页面的视觉质量，与设计规范逐项对比。",
                "",
                `### 审查目标`,
                `文件: ${fileUrl}`,
                "",
                "### 审查步骤（严格按顺序）",
                "1. browser_do navigate 到目标文件",
                "2. browser_do screenshot fullPage=true 截取全页面截图",
                "3. browser_do evaluate expression='$body' 检查 body 基础样式",
                "4. browser_do evaluate expression='$.sidebar' 检查侧边栏（或通过 class/id 查找）",
                "5. browser_do evaluate expression='$.stat-card' 检查统计卡片",
                "6. browser_do evaluate expression='$table' 检查表格样式",
                "7. 综合对比规范，输出问题清单或通过结论",
            ].join("\n"),
            status: "pending",
            results: [],
            createdAt: Date.now(),
            parentId: "webui-root",
        };
        board.addNode(reviewNode);
        const report2 = await scheduler.executeAll();
        console.log(`\n   ✅ 审查完成: ${report2.completed}/${report2.totalNodes} 成功`);
        const reviewNodeData = board.getNode(`review-r${round}`);
        const reviewResult = reviewNodeData?.results?.[0]?.output ?? "";
        const isPassed = reviewResult.includes("✓ 设计审查通过") || reviewResult.includes("设计审查通过");
        if (isPassed) {
            console.log(`\n🎉 ${p("browser", "设计审查通过！Dashboard 已就绪。")}`);
            break;
        }
        const problemMatches = reviewResult.match(/🔴|🟡|🟢/g);
        const problemCount = problemMatches?.length ?? 0;
        console.log(`\n   ⚠️ ${p("browser", `发现 ${problemCount} 个视觉问题，需要修复`)}`);
        if (round >= MAX_DESIGN_ROUNDS) {
            console.log(`\n   ⏰ 已达最大审查轮次，停止迭代`);
            break;
        }
        // ── 希格雯修复 ──
        console.log(`\n${p("fix", "开始修复视觉问题...")}`);
        const htmlContent = fs.readFileSync(HTML_OUTPUT, "utf-8");
        const fixNode = {
            id: `fix-r${round}`,
            type: "fix",
            tags: ["fix"],
            needsMultiPerspective: false,
            claimedBy: [],
            payload: [
                "## 当前 HTML 代码",
                "```html",
                htmlContent,
                "```",
                "",
                "## 宵宫的视觉审查反馈",
                reviewResult,
                "",
                "## 你的任务",
                "根据宵宫的反馈，精确定位并修复每个问题。只改 CSS 值/HTML 结构，不要重新设计整个页面。",
                "用 write_file 将完整修复后的 HTML 写入 dashboard.html。",
            ].join("\n"),
            status: "pending",
            results: [],
            createdAt: Date.now(),
            parentId: `review-r${round}`,
        };
        board.addNode(fixNode);
        const report3 = await scheduler.executeAll();
        console.log(`\n   ✅ 修复完成: ${report3.completed}/${report3.totalNodes} 成功`);
        // 提取修复后的代码并覆盖
        const fixNodeData = board.getNode(`fix-r${round}`);
        const fixResult = fixNodeData?.results?.[0]?.output ?? "";
        const htmlMatch = fixResult.match(/```html\n([\s\S]*?)\n```/) ??
            fixResult.match(/<html[\s\S]*?<\/html>/);
        if (htmlMatch) {
            fs.writeFileSync(HTML_OUTPUT, htmlMatch[1] ?? htmlMatch[0], "utf-8");
            console.log(`   📄 修复后的 HTML 已保存`);
        }
        else if (fs.existsSync(HTML_OUTPUT)) {
            // Agent 可能已通过 write_file 直接写入
            console.log(`   📄 dashboard.html 已更新`);
        }
    }
    // ═══════════════════════════════════════════════
    // 6. 收尾
    // ═══════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log("📊 最终报告");
    console.log(`${"═".repeat(60)}`);
    const allNodes = board.getAllNodes();
    const done = allNodes.filter(n => n.status === "done").length;
    const failed = allNodes.filter(n => n.status === "failed").length;
    const pending = allNodes.filter(n => n.status === "pending").length;
    console.log(`   总节点: ${allNodes.length}`);
    console.log(`   完成: ${done} | 失败: ${failed} | 未完成: ${pending}`);
    for (const n of allNodes) {
        const status = n.status === "done" ? "✅" : n.status === "failed" ? "❌" : "⏳";
        console.log(`   ${status} [${n.type}] ${n.id} (${n.status})`);
    }
    if (fs.existsSync(HTML_OUTPUT)) {
        const size = fs.statSync(HTML_OUTPUT).size;
        console.log(`\n   📄 最终产出: ${HTML_OUTPUT} (${(size / 1024).toFixed(1)} KB)`);
        console.log(`   🌐 可在浏览器打开: file:///${HTML_OUTPUT.replace(/\\/g, "/")}`);
    }
    // 清理
    await browserAgent.shutdown();
    await codeAgent.shutdown();
    await fixAgent.shutdown();
    memory.close();
    console.log(`\n✅ 宵宫视觉设计闭环测试完成\n`);
}
main().catch((e) => {
    console.error("❌ Fatal:", e);
    process.exit(1);
});
//# sourceMappingURL=webui-design-e2e.js.map