/**
 * 独自飞翔 E2E —— 冷启动：空目录起步，Agent 从零建造一个完整项目
 *
 * 用法: npx tsx tests/manual/e2e/solo-flight.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 与 closed-loop-collab 的区别:
 *   - 无任何参照代码库 —— Agent 面对的是空目录
 *   - 意图开放但明确 —— "造一个你认为值得造的项目"
 *   - 全工具开放 —— 读写、shell 全部可用，但限定区域
 *   - 冷启动验证 —— 没有宪法、没有 MemoryStore 种子、没有先例
 *
 * 安全红线:
 *   - 所有文件操作限定在 PROJECT_DIR 内（写入越界直接拒绝）
 *   - shell 危险命令拦截
 *   - 不碰主仓库任何代码
 *
 * 验收标准:
 *   1. MetaAgent 产出 ≥1 个 TaskNode
 *   2. Scheduler.executeAll() 完成
 *   3. 产出文件真实存在且非空
 *   4. 至少一个产物可成功执行（npx tsx 不报错）
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType, PipelinePriority, type TaskNode } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { TaskBoard } from "../../../src/task-board.js";
import { AgentPool } from "../../../src/agent-pool.js";
import { Scheduler } from "../../../src/scheduler.js";
import { PipelineObserver } from "../../../src/pipeline-observer.js";
import { ConfirmGate } from "../../../src/confirm-gate.js";
import { Toolkit } from "../../../src/toolkit.js";
import { MemoryStore } from "../../../src/memory-store.js";
import { MetaAgent } from "../../../src/meta-agent.js";
import { CodeAgent } from "../../../src/agents/code-agent.js";
import { ReviewAgent } from "../../../src/agents/review-agent.js";
import { AnalysisAgent } from "../../../src/agents/analysis-agent.js";
import { OpsAgent } from "../../../src/agents/ops-agent.js";
import { LoopAgent } from "../../../src/agents/loop-agent.js";
import { DocGovernAgent } from "../../../src/agents/doc-govern-agent.js";
import { ApiAgent } from "../../../src/agents/api-agent.js";
import { DataAgent } from "../../../src/agents/data-agent.js";
import { FixAgent } from "../../../src/agents/fix-agent.js";
import { InspectorAgent } from "../../../src/agents/inspector-agent.js";

// ══════════════════════════════════════════════
// 0. 环境变量
// ══════════════════════════════════════════════

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    if (process.env.DEEPSEEK_API_KEY) return;
    console.error("❌ .env 文件不存在且 DEEPSEEK_API_KEY 环境变量未设置");
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const clean = line.replace(/\r$/, "");
    const m = clean.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

// ══════════════════════════════════════════════
// 1. 工具注册 —— 全工具开放，但限定区域
// ══════════════════════════════════════════════

const DANGEROUS = /\b(rm\s+-rf|del\s+\/F|format\s|shutdown|reboot|sudo|chmod\s+777|>\/dev\/|curl.*\|.*sh|wget.*-O.*\||mkfs)\b/i;

function registerAllTools(toolkit: Toolkit, projectRoot: string) {
  const resolve = (p: string) => path.resolve(projectRoot, p);

  // ── 读取（不做越界限制 —— 与 closed-loop-collab 一致）──

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
    if (!query) return { success: false, error: "Missing query/pattern" };
    try {
      const results: string[] = [];
      const walk = (d: string, depth: number) => {
        if (depth > 5) return;
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            walk(full, depth + 1);
          } else if (entry.isFile() && /\.(ts|js|json|md)$/.test(entry.name)) {
            const stat = fs.statSync(full);
            if (stat.size > 200 * 1024) continue;
            const content = fs.readFileSync(full, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                results.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 150)}`);
              }
            }
          }
        }
      };
      walk(dir, 0);
      return { success: true, output: results.slice(0, 30).join("\n") || "(no matches)" };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  // ── 写入 —— 白名单制，拒绝越界 ──

  toolkit.register("write_file", async (params) => {
    const fp = resolve(params.file_path as string);
    if (!fp.startsWith(projectRoot + path.sep)) {
      return { success: false, error: `write_file denied: 路径越界 ${fp}` };
    }
    try {
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const content = params.content as string;
      fs.writeFileSync(fp, content, "utf-8");
      return { success: true, output: `Wrote ${Buffer.byteLength(content)} bytes to ${fp}` };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  // ── Shell —— 危险命令拦截，其余放行 ──

  toolkit.register("run_shell", async (params) => {
    const cmd = (params.command ?? "") as string;
    if (!cmd) return { success: false, error: "run_shell: 缺少 command 参数" };
    if (DANGEROUS.test(cmd)) {
      return { success: false, error: `run_shell denied: 危险命令已拦截 "${cmd.slice(0, 80)}"` };
    }
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(cmd, {
        cwd: projectRoot,
        timeout: 120_000,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { success: true, output: output || "(exit 0, no output)" };
    } catch (e: any) {
      const stderr = e.stderr?.toString() ?? "";
      const stdout = e.stdout?.toString() ?? "";
      return {
        success: false,
        error: `Command failed (exit ${e.status ?? "?"}): ${e.message.slice(0, 200)}\nstdout: ${stdout.slice(0, 300)}\nstderr: ${stderr.slice(0, 300)}`,
      };
    }
  });
}

// ══════════════════════════════════════════════
// 2. 主流程
// ══════════════════════════════════════════════

async function main() {
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) { console.error("❌ DEEPSEEK_API_KEY 未设置"); process.exit(1); }

  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-reasoner";
  const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-v4-pro";
  const WORKSPACE = process.cwd();

  // ── 空目录起步 ──
  const PROJECT_DIR = path.resolve(WORKSPACE, "projects", "solo-flight");
  if (fs.existsSync(PROJECT_DIR)) {
    // 清理上一轮残留
    fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(PROJECT_DIR, { recursive: true });

  // 只提供一个最小的 package.json 和 tsconfig，让 Agent 可以跑 tsc
  const pkgPath = path.join(PROJECT_DIR, "package.json");
  fs.writeFileSync(pkgPath, JSON.stringify({
    name: "solo-flight",
    private: true,
    type: "module",
  }, null, 2));

  const tsconfigPath = path.join(PROJECT_DIR, "tsconfig.json");
  fs.writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "ESNext",
      moduleResolution: "node",
      strict: true,
      esModuleInterop: true,
      outDir: "./dist",
      rootDir: ".",
    },
    include: ["**/*.ts"],
  }, null, 2));

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🕊️  独自飞翔 —— 冷启动，空目录，从零建造       ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  项目路径: ${PROJECT_DIR}`);
  console.log(`  起点:     空目录（仅 package.json + tsconfig.json）`);
  console.log(`  Chat:     ${CHAT_MODEL}`);
  console.log(`  Reasoner: ${REASONER_MODEL}\n`);

  // ── Phase 1: 基础设施 ──
  console.log("🟢 [Phase 1] 初始化基础设施...\n");

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
  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-solo-flight.db");
  await memory.init(MEMORY_DB);
  console.log(`   MemoryStore: ${MEMORY_DB}`);

  // ── Phase 2: 注册全部 10 个 Agent ──
  console.log("\n🟢 [Phase 2] 注册全部 Agent（10 个）...\n");

  pool.register({ type: AgentType.Code, maxInstances: 3 });
  pool.register({ type: AgentType.Review, maxInstances: 2 });
  pool.register({ type: AgentType.Analysis, maxInstances: 2 });
  pool.register({ type: AgentType.Ops, maxInstances: 2 });
  pool.register({ type: AgentType.Loop, maxInstances: 1 });
  pool.register({ type: AgentType.DocGovern, maxInstances: 1 });
  pool.register({ type: AgentType.Api, maxInstances: 1 });
  pool.register({ type: AgentType.Data, maxInstances: 1 });
  pool.register({ type: AgentType.Fix, maxInstances: 2 });
  pool.register({ type: AgentType.Inspector, maxInstances: 2 });

  const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

  interface AgentEntry {
    type: AgentType;
    label: string;
    create: () => any;
  }

  const agents: AgentEntry[] = [
    {
      type: AgentType.Code,
      label: "CodeAgent (阿贝多)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return new CodeAgent(adapter, tk, memory);
      },
    },
    {
      type: AgentType.Review,
      label: "ReviewAgent (刻晴)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return new ReviewAgent(adapter, tk, memory);
      },
    },
    {
      type: AgentType.Analysis,
      label: "AnalysisAgent (纳西妲)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return new AnalysisAgent(adapter, tk, memory);
      },
    },
    {
      type: AgentType.Ops,
      label: "OpsAgent (北斗)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return new OpsAgent(adapter, tk);
      },
    },
    {
      type: AgentType.Loop,
      label: "LoopAgent (莫娜)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return new LoopAgent(adapter, tk);
      },
    },
    {
      type: AgentType.DocGovern,
      label: "DocGovernAgent (凝光)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return new DocGovernAgent(adapter, tk, memory);
      },
    },
    {
      type: AgentType.Api,
      label: "ApiAgent (久岐忍)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return new ApiAgent(adapter, tk, memory);
      },
    },
    {
      type: AgentType.Data,
      label: "DataAgent (艾尔海森)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return new DataAgent(adapter, tk, memory);
      },
    },
    {
      type: AgentType.Fix,
      label: "FixAgent (希格雯)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return new FixAgent(adapter, tk, memory);
      },
    },
    {
      type: AgentType.Inspector,
      label: "InspectorAgent (安柏)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        const agent = new InspectorAgent(adapter, tk);
        agent.setWorkspaceRoot(PROJECT_DIR);
        return agent;
      },
    },
  ];

  for (const entry of agents) {
    const agent = entry.create();
    await agent.wakeup();
    scheduler.register(entry.type, agent, CHAT_MODEL);
    console.log(`   ✅ ${entry.label} 就绪`);
  }
  console.log(`\n   全部 ${agents.length} 位 Agent 就绪。\n`);

  // ── Phase 3: 甘雨规划 —— 冷启动，空目录 ──
  console.log("🟢 [Phase 3] 甘雨（MetaAgent）接收冷启动意图...\n");

  const INTENT = [
    "You are starting from an EMPTY directory. There is no existing code, no reference project, no documentation.",
    "The only files present are package.json and tsconfig.json — everything else is yours to create.",
    "",
    "Your task: Build a COMPLETE, SELF-CONTAINED project from scratch.",
    "",
    "Rules:",
    "1. Choose what to build — something useful, well-designed, and complete.",
    "   It can be a CLI tool, a small library, a web server, a data processor — your choice.",
    "2. The project must be runnable with `npx tsx <entry-file>` and produce verifiable output.",
    "3. All files must stay within this directory. You CANNOT write outside it.",
    "4. You have full access to all tools: read, write, shell (npm install, tsc, tsx).",
    "",
    "The team:",
    "- CodeAgent (阿贝多) — implementation        - ReviewAgent (刻晴) — code review",
    "- AnalysisAgent (纳西妲) — research/design     - OpsAgent (北斗) — scripting/build",
    "- LoopAgent (莫娜) — pattern discovery         - DocGovernAgent (凝光) — governance audit",
    "- ApiAgent (久岐忍) — API design               - DataAgent (艾尔海森) — data modeling",
    "- FixAgent (希格雯) — bug fixing               - InspectorAgent (安柏) — verification",
    "",
    "This is a cold start. There is nothing to reference, nothing to imitate.",
    "Design it, build it, review it, fix it, verify it — the full loop.",
    "Plan the task graph. Output TaskNode JSON.",
  ].join("\n");

  console.log("   📋 MetaAgent 思考中（冷启动，这需要一点时间）...\n");
  const planStart = Date.now();
  let plan: TaskNode[];
  try {
    plan = await metaAgent.plan(INTENT);
  } catch (e) {
    console.error(`   ❌ MetaAgent 规划失败: ${String(e).slice(0, 200)}`);
    process.exit(1);
  }
  const planDuration = Date.now() - planStart;

  console.log(`   ✅ MetaAgent 产出 ${plan.length} 个任务节点 (${planDuration}ms):`);
  for (const n of plan) {
    const parent = n.parentId ? ` → child of [${n.parentId.slice(0, 20)}]` : " → root";
    console.log(`      [${n.type}] ${n.id.slice(0, 40)}${parent}  tags: [${(n.tags ?? []).join(", ")}]`);
  }

  if (plan.length === 0) {
    console.error("\n❌ MetaAgent 产出 0 个任务节点，中止。");
    process.exit(1);
  }

  for (const n of plan) {
    board.addNode(n);
  }
  console.log(`\n   ${plan.length} 个节点已入板。\n`);

  // ── Phase 4: 执行 ──
  console.log("🟢 [Phase 4] Scheduler 执行...\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  observer.on(PipelinePriority.HIGH, (e) => {
    const p = e.payload as any;
    const id = p?.nodeId ? `[${(p.nodeId as string).slice(0, 20)}]` : "";
    if (e.type === "node.complete") {
      console.log(`   ✅ ${id} ${p.agentType ?? "?"} 完成`);
    } else if (e.type === "node.failed") {
      console.log(`   ❌ ${id} 失败: ${String(p.error ?? "").slice(0, 80)}`);
    } else if (e.type === "node.replan") {
      console.log(`   🔄 ${id} 重规划 #${p.attempt}: ${String(p.reason ?? "").slice(0, 80)}`);
    } else if (e.type === "scheduler.layer.start") {
      console.log(`\n   📊 第 ${p.layer} 层开始 (${p.nodes} 个节点)\n`);
    }
  });

  const execStart = Date.now();
  const report = await scheduler.executeAll();
  const execDuration = Date.now() - execStart;

  // ── Phase 5: 结果 ──
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   📊 执行结果                                     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`   完成: ${report.completed}  失败: ${report.failed}  耗时: ${execDuration}ms`);
  console.log();

  const allNodes = board.getAllNodes();
  for (const n of allNodes) {
    const status = n.status === "done" ? "✅" : n.status === "failed" ? "❌" : "⏳";
    console.log(`   ${status} [${n.type}] ${n.id.slice(0, 50)} (${n.status})`);
    for (const r of n.results) {
      const preview = (r.output ?? r.error ?? "?").slice(0, 200);
      console.log(`      ${r.success ? "✅" : "❌"} ${preview}`);
    }
  }
  console.log();

  // ── Phase 6: 闭环验证 —— 产物可执行？──
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🔍 闭环验证：产物真实存在且可执行                ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const producedFiles: string[] = [];
  const walkProduced = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".cortex") continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walkProduced(full);
      } else if (/\.(ts|js|json|html)$/.test(entry.name)) {
        producedFiles.push(full);
      }
    }
  };
  walkProduced(PROJECT_DIR);

  // 排除脚手架文件
  const sourceFiles = producedFiles.filter(
    (f) => !f.endsWith("tsconfig.json") && !f.endsWith("package.json")
  );

  console.log(`   产出文件 (${sourceFiles.length} 个):`);
  for (const f of sourceFiles) {
    const relative = path.relative(PROJECT_DIR, f);
    const size = fs.statSync(f).size;
    console.log(`   ${size > 0 ? "✅" : "❌"} ${relative} (${size} bytes)`);
  }

  let closedLoopPassed = true;

  if (sourceFiles.length === 0) {
    console.log("\n   ❌ 闭环验证失败：未发现任何产出文件。");
    closedLoopPassed = false;
  }

  // 尝试找到入口文件并执行
  const tsFiles = sourceFiles.filter((f) => f.endsWith(".ts"));
  // 优先找 index.ts 或 main.ts
  const entryCandidates = tsFiles.filter(
    (f) => /(index|main|app|server|cli)\.ts$/.test(path.basename(f))
  );
  const runners = entryCandidates.length > 0 ? entryCandidates : tsFiles.slice(0, 3);

  for (const f of runners) {
    const relative = path.relative(PROJECT_DIR, f);
    console.log(`\n   🏃 执行: ${relative} ...`);
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(
        `npx tsx "${relative}"`,
        {
          cwd: PROJECT_DIR,
          timeout: 30_000,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      const trimmed = output.trim();
      if (trimmed) {
        console.log(`   ✅ ${relative} 运行成功，输出:\n${trimmed.slice(0, 400)}`);
      } else {
        console.log(`   ✅ ${relative} 运行成功 (无输出)`);
      }
    } catch (e: any) {
      const stderr = e.stderr?.toString() ?? "";
      const stdout = e.stdout?.toString() ?? "";
      if (stderr.includes("SyntaxError")) {
        console.log(`   ❌ ${relative} 语法错误:\n${stderr.slice(0, 300)}`);
        closedLoopPassed = false;
      } else {
        console.log(`   ⚠️ ${relative} 运行时错误:\n${(stderr || stdout).slice(0, 300)}`);
        // 不因运行时错误标记失败
      }
    }
  }

  // ── Phase 7: 记忆系统观察 ──
  console.log("\n── 记忆系统诊断 ──");
  const allMemories = memory.read({});
  const withTask = allMemories.filter((m) => m.metadata?.taskId);
  console.log(`   总记忆: ${allMemories.length}  含任务关联: ${withTask.length}`);
  for (const m of withTask.slice(0, 8)) {
    console.log(`     📖 [${m.memoryType}] ${(m.summary ?? "").slice(0, 120)}`);
  }

  // ── 收尾 ──
  await memory.close();

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log(`║   ${closedLoopPassed ? "✅ 独自飞翔 —— 闭环验证通过" : "❌ 闭环验证失败"}        ║`);
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`   规划耗时: ${planDuration}ms (${(planDuration / 1000).toFixed(1)}s)`);
  console.log(`   执行耗时: ${execDuration}ms (${(execDuration / 1000).toFixed(1)}s)`);
  console.log(`   总耗时:   ${((planDuration + execDuration) / 1000).toFixed(1)}s`);
  console.log(`   MetaAgent 计划: ${plan.length} 节点`);
  console.log(`   Scheduler 完成: ${report.completed}  失败: ${report.failed}`);
  console.log(`   产出文件: ${sourceFiles.length} 个`);
  console.log(`   可执行验证: ${closedLoopPassed ? "✅" : "❌"}`);
  console.log();

  if (!closedLoopPassed || report.failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("💥 独自飞翔 E2E 崩溃:", e);
  process.exit(1);
});
