/**
 * 计算器系�?—�?专家协作闭环 E2E
 *
 * 用法: npx tsx tests/manual/calculator-e2e.ts
 * 前提: 项目根目�?.env 已配�?DEEPSEEK_API_KEY
 *
 * 场景：阿贝多写计算器代码 �?阿贝多写测试 �?安柏编译测试 �?刻晴审查 �?阿贝多修�?
 * 这不�?Mock，所有工具调用都是真实的。编译输出、测试结果、计算答案——全都是真的�?
 *
 * 三位专家的灵魂：
 *   CodeAgent (阿贝�?   �?�?PRODUCED_BY/REFACTORED_FROM 记忆 �?工人视角
 *   InspectorAgent (安柏) �?前置 child_process 采集 tsc/vitest �?确定性事�?
 *   ReviewAgent (刻晴)    �?�?CITED_IN_COMMITTEE/REFACTORED_FROM 记忆 �?历史审视
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType, MemoryType, LinkType, PipelinePriority, type TaskNode } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { TaskBoard } from "../../../src/task-board";
import { AgentPool } from "../../../src/agent-pool";
import { CodeAgent } from "../../../src/agents/code-agent";
import { ReviewAgent } from "../../../src/agents/review-agent";
import { InspectorAgent } from "../../../src/agents/inspector-agent";
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
  const resolve = (p: string) => path.resolve(projectRoot, p);

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
          } else if (entry.isFile() && /\.(ts|js|json|md)$/.test(entry.name)) {
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
    if (!cmd) return { success: false, error: "run_shell: 缺少 command 参数" };
    if (DANGEROUS.test(cmd)) {
      return { success: false, error: `run_shell denied: 危险命令已拦�?�?"${cmd.slice(0, 60)}"` };
    }
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(cmd, {
        cwd: projectRoot,
        timeout: 60_000,
        encoding: "utf-8",
        maxBuffer: 512 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { success: true, output: output || "(exit 0, no output)" };
    } catch (e: any) {
      const stderr = e.stderr?.toString() ?? "";
      const stdout = e.stdout?.toString() ?? "";
      return { success: false, error: `Command failed (exit ${e.status ?? "?"}): ${e.message.slice(0, 200)}\nstdout: ${stdout.slice(0, 200)}\nstderr: ${stderr.slice(0, 200)}` };
    }
  });
}

// ══════════════════════════════════════════════�?
// 3. 种子记忆
// ══════════════════════════════════════════════�?

function seedMemories(memory: MemoryStore, agentType: string): { lessonId: string; reviewId: string } {
  // 先查后写，防止重复播种导致记忆膨胀
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

  memory.link(reviewId, lessonId, LinkType.RefactoredFrom, agentType);
  memory.link(lessonId, reviewId, LinkType.CitedInCommittee, agentType);

  return { lessonId, reviewId };
}

// ══════════════════════════════════════════════�?
// 4. 主流�?
// ══════════════════════════════════════════════�?

async function main() {
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) { console.error("�?DEEPSEEK_API_KEY 未设�?); process.exit(1); }

  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-reasoner";
  const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-v4-pro";
  const WORKSPACE = process.cwd();

  const CALC_DIR = path.resolve(WORKSPACE, "projects", "calculator");
  const SRC_DIR = path.join(CALC_DIR, "src");
  const TEST_DIR = path.join(CALC_DIR, "test");

  for (const d of [CALC_DIR, SRC_DIR, TEST_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  // 确保 tsconfig.json 存在，Inspector �?tsc --noEmit 需�?
  const tsconfigPath = path.join(CALC_DIR, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    fs.writeFileSync(tsconfigPath, JSON.stringify({
      compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "node", strict: true, esModuleInterop: true, outDir: "./dist", rootDir: "." },
      include: ["src/**/*", "test/**/*"],
    }, null, 2));
  }

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("�?  🧪 计算器系�?�?专家协作闭环                      �?);
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  项目路径: ${CALC_DIR}`);
  console.log(`  Model:    ${CHAT_MODEL}`);
  console.log(`  Base:     ${BASE_URL}\n`);

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
  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-calc.db");
  await memory.init(MEMORY_DB);
  console.log(`   �?MemoryStore: ${MEMORY_DB}`);

  // ── 预置种子记忆 ──
  const seeds = seedMemories(memory, AgentType.Code);
  console.log(`   �?种子记忆: lesson=${seeds.lessonId.slice(0, 20)}...  review=${seeds.reviewId.slice(0, 20)}...`);

  // ── Agent 池注�?──
  pool.register({ type: AgentType.Code, maxInstances: 3 });
  pool.register({ type: AgentType.Review, maxInstances: 2 });
  pool.register({ type: AgentType.Inspector, maxInstances: 2 });

  const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

  // ── 注册 Agent（真实工�?+ 记忆）──
  console.log("🟢 [Phase 2] 注册 Agent �?真实工具 + 记忆...");

  const codeToolkit = new Toolkit(gate);
  registerCalculatorTools(codeToolkit, CALC_DIR);
  const codeAgent = new CodeAgent(adapter, codeToolkit, memory);
  await codeAgent.wakeup();
  scheduler.register(AgentType.Code, codeAgent, CHAT_MODEL);

  const inspectorToolkit = new Toolkit(gate);
  registerCalculatorTools(inspectorToolkit, CALC_DIR);
  const inspectorAgent = new InspectorAgent(adapter, inspectorToolkit);
  inspectorAgent.setWorkspaceRoot(CALC_DIR);
  await inspectorAgent.wakeup();
  scheduler.register(AgentType.Inspector, inspectorAgent, CHAT_MODEL);

  const reviewToolkit = new Toolkit(gate);
  registerCalculatorTools(reviewToolkit, CALC_DIR);
  const reviewAgent = new ReviewAgent(adapter, reviewToolkit, memory);
  await reviewAgent.wakeup();
  scheduler.register(AgentType.Review, reviewAgent, CHAT_MODEL);

  console.log("   �?3 位专家就�?(阿贝�?安柏/刻晴)\n");

  // ── 手动任务图（Scheduler 按入板顺序执行）──
  console.log("🟢 [Phase 3] 构建任务�?(5 节点，顺序执�?...");

  const taskContext = [
    "你工作在 projects/calculator/ 下。所有文件读写限定在此目录�?,
    "",
    "计算器系统：实现 Calculator 类，接收字符串表达式(�?\"2+3*4\")，支�?-*/、括号、优先级�?,
    "除以零返�?NaN，非法字符抛 Error�?,
  ].join("\n");

  const now = Date.now();
  // Scheduler �?parentId 做拓扑分�?�?严格串行
  const nodes: TaskNode[] = [
    {
      id: "task-1-write-calculator",
      type: "code",
      tags: ["implementation"],
      needsMultiPerspective: false,
      claimedBy: [],
      payload: `${taskContext}\n\nTASK 1: �?src/calculator.ts 实现 Calculator 类。接收字符串表达式，返回 number。支�?-*/、括号、优先级。除以零→NaN，非法字符→throw Error。只写这一个文件，写完立即给出最终答案。`,
      status: "pending",
      results: [],
      createdAt: now + 1,
    },
    {
      id: "task-2-write-tests",
      parentId: "task-1-write-calculator",
      type: "code",
      tags: ["test"],
      needsMultiPerspective: false,
      claimedBy: [],
      payload: `${taskContext}\n\nTASK 2: 读取 src/calculator.ts，写 test/calculator.test.ts。\n测试+-*/、括号、优先级、除以零(=NaN)、非法字�?=throw)。用�?assert(无外部框�?。Import 使用 '../src/calculator.js'（Node ESM 必须�?.js 扩展名）。写完给出最终答案。`,
      status: "pending",
      results: [],
      createdAt: now + 2,
    },
    {
      id: "task-3-inspect",
      parentId: "task-2-write-tests",
      type: "inspect",
      tags: ["inspect"],
      needsMultiPerspective: false,
      claimedBy: [],
      payload: `${taskContext}\n\nTASK 3: 勘察报告。\n系统已自动采�?tsc 编译�?vitest 测试结果（见下方[系统自动采集的编译事实]）。\n1. 读取 src/calculator.ts �?test/calculator.test.ts\n2. 结合编译/测试事实，逐条列出通过/失败/文件状态\n只报告事实，不推断。如果发现编译或测试失败，明确写出失败原因。`,
      status: "pending",
      results: [],
      createdAt: now + 3,
    },
    {
      id: "task-4-review",
      parentId: "task-3-inspect",
      type: "review",
      tags: ["review"],
      needsMultiPerspective: false,
      claimedBy: [],
      payload: `${taskContext}\n\nTASK 4: 审查 src/calculator.ts �?test/calculator.test.ts。\n关注：代码质量、错误处理、测试覆盖、模块拆分建议。\n给结构化审查意见（严重度+位置+建议）。`,
      status: "pending",
      results: [],
      createdAt: now + 4,
    },
    {
      id: "task-5-fix",
      parentId: "task-4-review",
      type: "code",
      tags: ["bugfix"],
      needsMultiPerspective: false,
      claimedBy: [],
      payload: `${taskContext}\n\nTASK 5: 如果 task-4 审查发现有需修复的问题，读取审查意见后修�?src/calculator.ts �?test/calculator.test.ts。修复完后读取改动的文件确认。只修复审查指出的问题，不多改。`,
      status: "pending",
      results: [],
      createdAt: now + 5,
    },
  ];

  for (const n of nodes) board.addNode(n);
  console.log(`   �?${nodes.length} 个任务节点入�?(parentId 链式拓扑，逐层串行)`);
  for (const n of nodes) {
    const parent = n.parentId ? ` �?child of [${n.parentId.slice(0, 16)}]` : " �?root";
    console.log(`     [${n.type}] ${n.id}${parent}  tags: [${n.tags.join(", ")}]`);
  }
  console.log();

  // ── 事件监听 ──
  observer.on(PipelinePriority.HIGH, (e) => {
    const payload = e.payload as any;
    const nodeId = payload?.nodeId ?? "";
    const snippet = JSON.stringify(payload).slice(0, 120);
    console.log(`   📡 ${e.type}: ${nodeId ? nodeId : snippet}`);
  });

  // ── 执行 ──
  console.log("🟢 [Phase 4] Scheduler 执行 �?三位专家开始协�?..\n");
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
    console.log(`   ${status} [${n.type}] ${n.id} (${n.status})`);
    for (const r of n.results) {
      const preview = (r.output ?? r.error ?? "?").slice(0, 160);
      console.log(`      ${r.success ? "�? : "�?} ${preview}`);
    }
  }
  console.log();

  // ── 产出文件检�?──
  console.log("── 产出文件 ──");
  const checkFiles = ["src/calculator.ts", "test/calculator.test.ts"];
  for (const rel of checkFiles) {
    const fp = path.join(CALC_DIR, rel);
    const exists = fs.existsSync(fp);
    const size = exists ? fs.statSync(fp).size : 0;
    console.log(`   ${exists ? "�? : "�?} ${rel}  ${exists ? `(${size} bytes)` : "(未生�?"}`);
  }
  console.log();

  // ── 验证计算器是否真的能运行 ──
  console.log("── 验证：用 npx tsx 运行计算器测�?──");
  try {
    const { execSync } = await import("node:child_process");
    const testOutput = execSync("npx tsx test/calculator.test.ts", {
      cwd: CALC_DIR,
      timeout: 30_000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(`   �?计算器测试全部通过:\n${testOutput.slice(0, 500)}`);
  } catch (e: any) {
    const stdout = e.stdout?.toString() ?? "";
    const stderr = e.stderr?.toString() ?? "";
    console.log(`   �?计算器测试失�?(exit ${e.status ?? "?"})`);
    if (stdout) console.log(`   stdout:\n${stdout.slice(0, 400)}`);
    if (stderr) console.log(`   stderr:\n${stderr.slice(0, 400)}`);
  }

  // ── 灵魂观察�?──
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("�?  🎭 专家灵魂观察�?                              �?);
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log("   1. 阿贝多（CodeAgent）在 think 阶段有没有引�?);
  console.log("      「施工教训」「忘�?mock」「依赖路径」？");
  console.log("   2. 安柏（InspectorAgent）的勘察报告里编�?测试");
  console.log("      结果是真实的 tsc/vitest 输出，还�?LLM 编的�?);
  console.log("   3. 刻晴（ReviewAgent）审查时有没有翻出历史评论：");
  console.log("      「耦合度太高」「需拆分 Parser/Calculator」？");
  console.log();
  console.log("   如果三点全中——你的专家就不是换皮 bot，而是");
  console.log("   带着记忆和工具、以完全不同方式干活的专业人士�?);
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

  console.log(`   全流程耗时: ${execDuration}ms\n`);
}

main().catch((err) => {
  console.error("�?计算�?E2E 失败:", err);
  process.exit(1);
});
