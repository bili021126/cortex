/**
 * WebUI 计算器系�?—�?MetaAgent 自规�?+ 宵宫验证 E2E
 *
 * 用法: npx tsx tests/manual/webui-calculator-e2e.ts
 * 前提: 项目根目�?.env 已配�?DEEPSEEK_API_KEY
 *
 * 场景：甘雨（MetaAgent）接收用户意�?�?自规划任务树 �?阿贝多写前端 �?
 *       宵宫（BrowserAgent）用真实浏览器验�?�?安柏复查 �?刻晴审查
 *
 * �?calculator-e2e.ts 的核心差异：
 *   - 不用硬编码节点，�?MetaAgent.plan() 自己拆解意图
 *   - BrowserAgent（宵宫）�?Playwright 操作真实浏览�?
 *   - 验证 WebUI 而非 CLI 计算�?
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType, MemoryType, LinkType, PipelinePriority, type TaskNode } from "@cortex/shared";
import { AgentStatus as AS } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { TaskBoard } from "../../../src/task-board";
import { AgentPool } from "../../../src/agent-pool";
import { CodeAgent } from "../../../src/agents/code-agent";
import { ReviewAgent } from "../../../src/agents/review-agent";
import { InspectorAgent } from "../../../src/agents/inspector-agent";
import { BrowserAgent } from "../../../src/agents/browser-agent";
import { AnalysisAgent } from "../../../src/agents/analysis-agent";
import { DocGovernAgent } from "../../../src/agents/doc-govern-agent";
import { LoopAgent } from "../../../src/agents/loop-agent";
import { OpsAgent } from "../../../src/agents/ops-agent";
import { Scheduler } from "../../../src/scheduler";
import { PipelineObserver } from "../../../src/pipeline-observer";
import { ConfirmGate } from "../../../src/confirm-gate";
import { Toolkit } from "../../../src/toolkit";
import { MemoryStore } from "../../../src/memory-store";
import { MetaAgent } from "../../../src/meta-agent";

// ══════════════════════════════════════════════�?
// 1. 环境变量
// ══════════════════════════════════════════════�?

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.error("�?.env 文件不存�?);
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const clean = line.replace(/\r$/, "");
    const m = clean.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

// ══════════════════════════════════════════════�?
// 2. 真实工具 �?限定 projects/calculator/
// ══════════════════════════════════════════════�?

function registerCalculatorTools(toolkit: Toolkit, projectRoot: string) {
  const resolve = (p: string) => {
    // 剥离 projects/calculator/ 前缀——projectRoot 已经包含�?
    let clean = p as string;
    if (clean.startsWith("projects/calculator/")) {
      clean = clean.slice("projects/calculator/".length);
    }
    return path.resolve(projectRoot, clean);
  };

  toolkit.register("read_file", async (params) => {
    const fp = resolve(params.file_path as string);
    if (!fs.existsSync(fp)) return { success: false, error: `File not found: ${fp}` };
    try {
      return { success: true, output: fs.readFileSync(fp, "utf-8") };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  const listHandler = async (params: any) => {
    const dp = resolve((params.dir_path ?? params.path ?? ".") as string);
    if (!fs.existsSync(dp)) return { success: false, error: `Dir not found: ${dp}` };
    try {
      const entries = fs.readdirSync(dp, { withFileTypes: true });
      const listing = entries.map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`).join("\n");
      return { success: true, output: listing };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  };
  toolkit.register("list_files", listHandler);
  toolkit.register("list_dir", listHandler);

  toolkit.register("search_code", async (params) => {
    const query = (params.query ?? params.pattern ?? "") as string;
    const dir = resolve((params.path ?? ".") as string);
    if (!query) return { success: false, error: "Missing query/path" };
    try {
      const results: string[] = [];
      const walk = (d: string, depth: number) => {
        if (depth > 4) return;
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            walk(full, depth + 1);
          } else if (entry.isFile() && /\.(html|js|css|ts|json|md)$/.test(entry.name)) {
            const stat = fs.statSync(full);
            if (stat.size > 100 * 1024) continue;
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
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  toolkit.register("write_file", async (params) => {
    const fp = resolve(params.file_path as string);
    if (!fp.startsWith(projectRoot + path.sep)) {
      return { success: false, error: `write_file denied: 路径越界 �?${fp} 不在 calculator 项目内` };
    }
    try {
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fp, params.content as string, "utf-8");
      return { success: true, output: `Wrote ${Buffer.byteLength(params.content as string)} bytes to ${fp}` };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  const DANGEROUS = new RegExp("\\b(rm\\s+-rf|del\\s+/F|format\\s|shutdown|reboot|sudo|chmod\\s+777|>/dev/|/etc/)");
  toolkit.register("run_shell", async (params) => {
    const cmd = (params.command ?? "") as string;
    if (DANGEROUS.test(cmd)) return { success: false, error: "Dangerous command blocked" };
    if (!cmd.startsWith("node") && !cmd.startsWith("npx") && !cmd.startsWith("npm")) {
      return { success: false, error: `Only node/npx/npm allowed. Got: ${cmd.slice(0, 50)}` };
    }
    try {
      const { execSync } = await import("node:child_process");
      const out = execSync(cmd, { cwd: projectRoot, timeout: 30_000, encoding: "utf-8" });
      return { success: true, output: out };
    } catch (e: any) {
      return { success: false, error: String(e.stderr ?? e.message ?? e).slice(0, 500) };
    }
  });
}

// ══════════════════════════════════════════════�?
// 3. 种子记忆
// ══════════════════════════════════════════════�?

function seedMemories(memory: MemoryStore, agentType: string): { lessonId: string; reviewId: string } {
  // 先查后写，防止重复播�?
  const existingLesson = memory.read({ metadataFilter: { taskId: "lesson-math-mock" }, limit: 1 });
  const existingReview = memory.read({ metadataFilter: { taskId: "review-math-coupling" }, limit: 1 });

  const lessonId = existingLesson.length > 0
    ? existingLesson[0].id
    : memory.write({
        memoryType: MemoryType.Episodic,
        content: {
          taskType: "code",
          entities: ["math", "calculator", "arithmetic"],
          decision: "上次实现 math-utils 时忘�?mock 依赖导致 CI 红了一下午。教训：写模块前先确认依赖路径，写完立即跑测试验证�?,
          outcome: "fixed",
        },
        summary: "【施工教训】写 math-utils 时忘�?mock 导致 CI 报错，排�?2 小时才发现依赖路径问题。新模块务必先确认依赖�?,
        agentType: agentType as any,
        creatorId: agentType,
        metadata: { taskId: "lesson-math-mock", module: "math" },
      });

  const reviewId = existingReview.length > 0
    ? existingReview[0].id
    : memory.write({
        memoryType: MemoryType.Episodic,
        content: {
          taskType: "review",
          entities: ["math", "calculator", "parser"],
          decision: "审查 math-utils 时发现表达式解析和计算逻辑耦合在同一函数里，建议拆分 Parser �?Calculator。另外错误处理不完整，除以零未处理�?,
          outcome: "needs_fix",
        },
        summary: "【审查档案】math-utils 审查结论：表达式解析和计算逻辑耦合，错误处理不完整（除以零/非法字符）。建议拆分模块�?,
        agentType: agentType as any,
        creatorId: agentType,
        metadata: { taskId: "review-math-coupling", module: "math" },
      });

  // 幂等建立关联（link 自带去重�?
  memory.link(reviewId, lessonId, LinkType.RefactoredFrom, agentType);
  memory.link(lessonId, reviewId, LinkType.CitedInCommittee, agentType);

  return { lessonId, reviewId };
}

// ══════════════════════════════════════════════�?
// 4. 主流�?
// ══════════════════════════════════════════════�?

/** Agent 类型 �?人类可读名称 */
function agentName(type: string): string {
  const map: Record<string, string> = {
    code: "阿贝�?(Code)",
    review: "刻晴 (Review)",
    inspector: "安柏 (Inspector)",
    browser: "宵宫 (Browser)",
    analysis: "纳西�?(Analysis)",
    "doc-govern": "凝光 (DocGovern)",
    loop: "莫娜 (Loop)",
    ops: "北斗 (Ops)",
  };
  return map[type] ?? type;
}

async function main() {
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) { console.error("�?DEEPSEEK_API_KEY 未设�?); process.exit(1); }

  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-reasoner";
  const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-v4-pro";
  const WORKSPACE = process.cwd();

  const CALC_DIR = path.resolve(WORKSPACE, "projects", "calculator");
  const WEBUI_DIR = path.join(CALC_DIR, "webui");

  // 确保目录存在
  for (const d of [CALC_DIR, WEBUI_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  // 清理 webui/ 目录中上次运行的残留文件
  if (fs.existsSync(WEBUI_DIR)) {
    for (const entry of fs.readdirSync(WEBUI_DIR)) {
      const full = path.join(WEBUI_DIR, entry);
      if (fs.statSync(full).isFile()) fs.unlinkSync(full);
    }
  }

  // 清理 .cortex/e2e-output 残留文件（Agent 可能写到这里�?test.js 等）
  const e2eOutDir = path.join(CALC_DIR, ".cortex", "e2e-output");
  if (fs.existsSync(e2eOutDir)) {
    for (const entry of fs.readdirSync(e2eOutDir)) {
      fs.unlinkSync(path.join(e2eOutDir, entry));
    }
  }

  // 清理嵌套路径（Agent 可能写到 projects/calculator/projects/... 导致路径重复�?
  const nestedDir = path.join(CALC_DIR, "projects");
  if (fs.existsSync(nestedDir)) {
    fs.rmSync(nestedDir, { recursive: true, force: true });
  }

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("�?  🌐 WebUI 计算�?�?MetaAgent 自规�?+ 宵宫验证       �?);
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  项目: ${CALC_DIR}`);
  console.log(`  Model: ${CHAT_MODEL}`);
  console.log(`  Base:  ${BASE_URL}\n`);

  // ── 初始化组�?──
  console.log("🟢 [Phase 1] 初始化组�?..");

  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    reasonerModel: REASONER_MODEL,
    reasoningEffort: "high",
  });
  adapter.setCacheEnabled(true);

  const metaAgent = new MetaAgent(adapter);
  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();
  const gate = new ConfirmGate();
  gate.bypassAll();

  const memory = new MemoryStore();
  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-webui-calc.db");
  await memory.init(MEMORY_DB);
  console.log(`   �?MemoryStore: ${MEMORY_DB}`);

  const seeds = seedMemories(memory, AgentType.Code);
  console.log(`   �?种子记忆: lesson=${seeds.lessonId.slice(0, 20)}...  review=${seeds.reviewId.slice(0, 20)}...\n`);

  // ── Agent 池注�?──
  pool.register({ type: AgentType.Code, maxInstances: 3 });
  pool.register({ type: AgentType.Review, maxInstances: 2 });
  pool.register({ type: AgentType.Inspector, maxInstances: 2 });
  pool.register({ type: AgentType.Browser, maxInstances: 1 });
  pool.register({ type: AgentType.Analysis, maxInstances: 2 });
  pool.register({ type: AgentType.DocGovern, maxInstances: 1 });
  pool.register({ type: AgentType.Ops, maxInstances: 1 });
  pool.register({ type: AgentType.Loop, maxInstances: 1 });

  const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

  // ── 注册 Agent ──
  console.log("🟢 [Phase 2] 注册八位专家...");

  // CodeAgent（阿贝多）—�?炼金术士，写代码、修 bug、重�?
  const codeToolkit = new Toolkit(gate);
  registerCalculatorTools(codeToolkit, CALC_DIR);
  const codeAgent = new CodeAgent(adapter, codeToolkit, memory);
  await codeAgent.wakeup();
  scheduler.register(AgentType.Code, codeAgent, CHAT_MODEL);
  console.log("   �?阿贝�?(Code) �?炼金术士");

  // ReviewAgent（刻晴）—�?玉衡星，代码审查
  const reviewToolkit = new Toolkit(gate);
  registerCalculatorTools(reviewToolkit, CALC_DIR);
  const reviewAgent = new ReviewAgent(adapter, reviewToolkit, memory);
  await reviewAgent.wakeup();
  scheduler.register(AgentType.Review, reviewAgent, CHAT_MODEL);
  console.log("   �?刻晴 (Review) �?玉衡�?);

  // InspectorAgent（安柏）—�?侦察骑士，纯事实采集
  const inspectorToolkit = new Toolkit(gate);
  registerCalculatorTools(inspectorToolkit, CALC_DIR);
  const inspectorAgent = new InspectorAgent(adapter, inspectorToolkit);
  inspectorAgent.setWorkspaceRoot(CALC_DIR);
  await inspectorAgent.wakeup();
  scheduler.register(AgentType.Inspector, inspectorAgent, CHAT_MODEL);
  console.log("   �?安柏 (Inspector) �?侦察骑士");

  // BrowserAgent（宵宫）—�?烟花店老板，UI 验证
  const browserToolkit = new Toolkit(gate);
  const browserAgent = new BrowserAgent(adapter, browserToolkit);
  browserAgent.setWorkspaceRoot(WORKSPACE);
  await browserAgent.wakeup();
  scheduler.register(AgentType.Browser, browserAgent, CHAT_MODEL);
  console.log("   �?宵宫 (Browser) �?烟花店老板");

  // AnalysisAgent（纳西妲）—�?草神，架构分�?
  const analysisToolkit = new Toolkit(gate);
  registerCalculatorTools(analysisToolkit, CALC_DIR);
  const analysisAgent = new AnalysisAgent(adapter, analysisToolkit, memory);
  await analysisAgent.wakeup();
  scheduler.register(AgentType.Analysis, analysisAgent, CHAT_MODEL);
  console.log("   �?纳西�?(Analysis) �?草神");

  // DocGovernAgent（凝光）—�?天权星，律法审计
  const docGovernToolkit = new Toolkit(gate);
  registerCalculatorTools(docGovernToolkit, CALC_DIR);
  const docGovernAgent = new DocGovernAgent(adapter, docGovernToolkit);
  await docGovernAgent.wakeup();
  scheduler.register(AgentType.DocGovern, docGovernAgent, CHAT_MODEL);
  console.log("   �?凝光 (DocGovern) �?天权�?);

  // LoopAgent（莫娜）—�?占星术士，模式提�?
  const loopToolkit = new Toolkit(gate);
  registerCalculatorTools(loopToolkit, CALC_DIR);
  const loopAgent = new LoopAgent(adapter, loopToolkit);
  await loopAgent.wakeup();
  scheduler.register(AgentType.Loop, loopAgent, CHAT_MODEL);
  console.log("   �?莫娜 (Loop) �?占星术士");

  // OpsAgent（北斗）—�?南十字船长，运维部署
  const opsToolkit = new Toolkit(gate);
  registerCalculatorTools(opsToolkit, CALC_DIR);
  const opsAgent = new OpsAgent(adapter, opsToolkit);
  await opsAgent.wakeup();
  scheduler.register(AgentType.Ops, opsAgent, CHAT_MODEL);
  console.log("   �?北斗 (Ops) �?南十字船长\n");

  // ── MetaAgent 自规�?──
  console.log("🟢 [Phase 3] 甘雨（MetaAgent）理解意图、自规划任务�?..\n");

  const intent = [
    "从零实现一�?WebUI 计算器系统。代码全部放�?projects/calculator/webui/ 目录下�?,
    "不要写任�?test.js 或测试文件——只需�?calculator.js �?index.html 两个文件�?,
    "",
    "⚠️ 关键约束�?,
    "1. 所有文档必须用 write_file 工具输出到磁盘——不能只在脑子里分析，必须写出文件�?,
    "2. HTML 页面元素�?ID 必须使用约定名称：输入框 #expression、按�?#calculateBtn、结果区 #result�?,
    "   不要用其�?ID，不要自行发挥�?,
    "",
    "功能要求�?,
    "�?calculator.js �?纯浏览器�?JavaScript，不�?Node.js API（不要用 require/fs/path）�?,
    "  evaluate(str) 解析 +,-,*,/ 和括号表达式，遵循标准运算符优先级�?,
    "  除以零返�?'NaN'，非法字符和语法错误抛出明确�?Error�?,
    "�?index.html �?完整的用户界面。使用约�?ID�?expression（输入框）�?calculateBtn（按钮）�?result（结果区）�?,
    "  通过 <script src=\"calculator.js\"> 加载逻辑。必须能通过 file:// 协议直接打开�?,
    "",
    "需要由阿贝多先�?write_file 写出这两个文件，然后安柏去侦察文件是否齐全、内容是否正确，",
    "接下来宵宫用浏览器验证三组表达式�?+3*4=14, (10-2)/4=2, 1/0=NaN），",
    "刻晴审查代码质量，纳西妲做架构分析并�?write_file 输出 architecture.md�?,
    "凝光做合规审计并�?write_file 输出 audit-report.md，莫娜提炼模式，北斗检查部署就绪性�?,
    "",
    "还要�?write_file 输出以下文档，每份独立成文件，放�?webui/ 目录下：",
    "�?webui/README.md �?项目文档：用法、文件结构、API 文档（evaluate 签名和示例）、架构图�?,
    "�?webui/audit-report.md �?凝光的合规审计报告：规范性检查结果、发现的问题、改进建议�?,
    "�?webui/architecture.md �?纳西妲的架构分析：模块划分、职责分离、可扩展性评估、优化方向�?,
  ].join("\n");

  console.log("   📋 用户意图:");
  console.log(`   ${intent.split("\n").slice(0, 5).join("\n").slice(0, 200)}...\n`);

  console.log("   �?甘雨正在规划...");
  const planStart = Date.now();
  let nodes: TaskNode[];
  try {
    nodes = await metaAgent.plan(intent, {
      existingTags: ["implementation", "browser", "ui_verify"],
    });
  } catch (e) {
    console.error(`   �?MetaAgent 规划失败: ${e}`);
    process.exit(1);
  }
  console.log(`   �?规划完成 (${Date.now() - planStart}ms): ${nodes.length} 个任务节点\n`);

  if (nodes.length === 0) {
    console.error("   �?MetaAgent 未生成任何任务节�?);
    process.exit(1);
  }

  for (const n of nodes) {
    const parent = n.parentId ? ` �?child of [${n.parentId.slice(0, 16)}]` : " �?root";
    console.log(`     [${n.type}] ${n.tags.join(", ")}  ${n.id}${parent}`);
    const payloadPreview = n.payload.slice(0, 100);
    console.log(`        ${payloadPreview}...`);
  }

  // 依赖结构诊断
  const roots = nodes.filter((n) => !n.parentId);
  const nonRoots = nodes.filter((n) => n.parentId);
  console.log(`\n   🌳 依赖结构: ${roots.length} 个根节点, ${nonRoots.length} 个子节点`);
  if (nonRoots.length === 0) {
    console.log("   ⚠️ 诊断：所有节点都是根节点——甘雨没有建立时序依赖！");
  } else {
    // 按层级展�?
    const byParentId = new Map<string, TaskNode[]>();
    const rootById = new Map<string, TaskNode>();
    for (const n of nodes) {
      rootById.set(n.id, n);
      if (n.parentId) {
        const existing = byParentId.get(n.parentId);
        if (existing) existing.push(n); else byParentId.set(n.parentId, [n]);
      }
    }
    let layer = 0;
    let current = roots;
    while (current.length > 0) {
      console.log(`   Layer ${layer}: ${current.map((n) => agentName(n.tags[0] ?? n.type).split(" ")[0]).join(" �?")}`);
      const next: TaskNode[] = [];
      for (const n of current) {
        const children = byParentId.get(n.id);
        if (children) next.push(...children);
      }
      current = next;
      layer++;
    }
  }
  console.log();

  // ── 入板 ──
  for (const n of nodes) board.addNode(n);

  // ── 事件监听 ──
  observer.on(PipelinePriority.HIGH, (e) => {
    const payload = e.payload as any;
    const nodeId = payload?.nodeId ?? "";
    const snippet = JSON.stringify(payload).slice(0, 120);
    console.log(`   📡 ${e.type}: ${nodeId ? nodeId : snippet}`);
  });

  // ── 执行 ──
  console.log("🟢 [Phase 4] Scheduler 执行 �?八位专家开始协�?..\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const execStart = Date.now();
  const report = await scheduler.executeAll();
  const execDuration = Date.now() - execStart;

  // ── 结果 ──
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("�?  📊 执行结果                                     �?);
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`   完成: ${report.completed}  失败: ${report.failed}  耗时: ${execDuration}ms`);
  console.log();

  const allNodes = board.getAllNodes();
  for (const n of allNodes) {
    const status = n.status === "done" ? "�? : n.status === "failed" ? "�? : "�?;
    const agentLabel = agentName(n.results[0]?.agentType ?? n.tags[0]);
    console.log(`   ${status} [${n.type}] ${n.tags.join(", ")}  ${agentLabel}`);
  }
  console.log();

  // ── 专家发言 ──
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("�?  🎭 专家发言实录                                  �?);
  console.log("╚══════════════════════════════════════════════════╝\n");

  for (const n of allNodes) {
    if (n.results.length === 0 || n.status === "pending") continue;
    const r = n.results[0];
    const label = agentName(r.agentType ?? "unknown");
    const content = (r.output ?? r.error ?? "(无输�?").trim();

    console.log(`── ${r.success ? "�? : "�?} ${label} ──`);
    // 完整输出，不截断
    const indent = "   ";
    const lines = content.split("\n");
    for (const line of lines) {
      console.log(`${indent}${line}`);
    }
    console.log();
  }

  // ── 产出文件检�?──
  console.log("── 产出文件 ──");
  const checkFiles = [
    "webui/index.html",
    "webui/calculator.js",
    "webui/README.md",
    "webui/audit-report.md",
    "webui/architecture.md",
  ];
  for (const rel of checkFiles) {
    const fp = path.join(CALC_DIR, rel);
    const exists = fs.existsSync(fp);
    const size = exists ? fs.statSync(fp).size : 0;
    console.log(`   ${exists ? "�? : "�?} ${rel}  ${exists ? `(${size} bytes)` : "(未生�?"}`);
  }
  console.log();

  // ── 内容检�?──
  const indexPath = path.join(CALC_DIR, "webui", "index.html");
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, "utf-8");
    const hasInput = /#expression|id\s*=\s*["']expression/.test(html);
    const hasButton = /#calculateBtn|calculateBtn|Calculate|计算/.test(html);
    const hasResult = /#result|id\s*=\s*["']result/.test(html);
    const hasScript = /calculator\.js|script\s*src/.test(html);
    console.log("── HTML 结构验证 ──");
    console.log(`   ${hasInput ? "�? : "�?} #expression input`);
    console.log(`   ${hasButton ? "�? : "�?} calculate button`);
    console.log(`   ${hasResult ? "�? : "�?} #result display`);
    console.log(`   ${hasScript ? "�? : "�?} calculator.js loaded`);
    console.log();
  }

  const jsPath = path.join(CALC_DIR, "webui", "calculator.js");
  if (fs.existsSync(jsPath)) {
    const js = fs.readFileSync(jsPath, "utf-8");
    const hasEvaluate = /evaluate|calculate|compute/i.test(js);
    const hasOperator = /[\+\-\*\/]/.test(js);
    console.log("── JS 逻辑验证 ──");
    console.log(`   ${hasEvaluate ? "�? : "�?} evaluate/compute function`);
    console.log(`   ${hasOperator ? "�? : "�?} arithmetic operators`);
    console.log();
  }

  // ── 文档内容检�?──
  const docSpecs: Array<{ file: string; label: string; checks: Array<{ name: string; pattern: RegExp }> }> = [
    {
      file: "webui/README.md",
      label: "README（项目文档）",
      checks: [
        { name: "项目概述", pattern: /概述|overview|简介|介绍/i },
        { name: "使用方法", pattern: /使用|用法|usage|how to/i },
        { name: "API 文档", pattern: /evaluate|API|接口|函数/i },
        { name: "文件/架构", pattern: /文件|结构|目录|structure|architecture/i },
      ],
    },
    {
      file: "webui/audit-report.md",
      label: "审计报告",
      checks: [
        { name: "检查项列表", pattern: /检查|审计|audit|规范|compliance/i },
        { name: "问题发现", pattern: /问题|issue|缺陷|风险|违规/i },
        { name: "改进建议", pattern: /建议|改进|recommend|修复/i },
      ],
    },
    {
      file: "webui/architecture.md",
      label: "架构分析",
      checks: [
        { name: "模块划分", pattern: /模块|module|组件|component/i },
        { name: "职责分离", pattern: /职责|责任|分离|解耦|separation/i },
        { name: "评估/建议", pattern: /评估|建议|优化|改进|可扩�?i },
      ],
    },
  ];

  for (const spec of docSpecs) {
    const fp = path.join(CALC_DIR, spec.file);
    if (!fs.existsSync(fp)) {
      console.log(`── ${spec.label} ──`);
      console.log(`   �?文件未生成\n`);
      continue;
    }
    const content = fs.readFileSync(fp, "utf-8");
    console.log(`── ${spec.label} ──`);
    for (const c of spec.checks) {
      console.log(`   ${c.pattern.test(content) ? "�? : "�?} ${c.name}`);
    }
    console.log(`   字数: ${content.length}\n`);
  }

  // ── 宵宫侦察 ──
  console.log("── 宵宫（BrowserAgent）执行摘�?──");
  const browserNodes = allNodes.filter((n) =>
    n.tags.some((t) => t === "browser" || t === "ui_verify"),
  );
  if (browserNodes.length === 0) {
    console.log("   ⚠️ MetaAgent 未规划任何浏览器验证任务�?);
    console.log("   猜测甘雨认为�?WebUI 不需要浏览器验证，或计划不完整。\n");
  } else {
    for (const n of browserNodes) {
      if (n.status === "done") {
        console.log(`   �?${n.id}: 验证完成`);
      } else {
        console.log(`   �?${n.id}: ${n.status}`);
      }
    }
  }
  console.log();

  // ── 记忆系统诊断 ──
  console.log("── 记忆系统诊断 ──");
  const allMemories = memory.read({});
  const accessed = allMemories.filter((m) => m.lastAccessedAt > m.createdAt + 1000);
  console.log(`   总记�? ${allMemories.length}  被访问过: ${accessed.length}`);
  for (const m of accessed) {
    console.log(`     📖 ${m.summary.slice(0, 100)}`);
  }
  console.log();

  // ── 清理 ──
  try { await browserAgent.shutdown(); } catch { /* 静默 */ }

  console.log(`   全流程耗时: ${execDuration}ms\n`);
}

main().catch((err) => {
  console.error("�?WebUI 计算�?E2E 失败:", err);
  // 即使失败也尝试清�?
  process.exit(1);
});
