/**
 * 手动 E2E 快速验证—最简意图全管线打通
 *
 * 用法: npx tsx tests/manual/manual-e2e-verify.ts
 * 前提: 项目根目录?.env 已配置 DEEPSEEK_API_KEY
 *
 * 验证链路:
 *   用户意图 -> MetaAgent 规划 -> Scheduler 执行 -> 诊断
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType, PipelinePriority } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { MetaAgent } from "../../../src/meta-agent";
import { TaskBoard } from "../../../src/task-board";
import { AgentPool } from "../../../src/agent-pool";
import { CodeAgent } from "../../../src/agents/code-agent";
import { ReviewAgent } from "../../../src/agents/review-agent";
import { AnalysisAgent } from "../../../src/agents/analysis-agent";
import { DocGovernAgent } from "../../../src/agents/doc-govern-agent";
import { InspectorAgent } from "../../../src/agents/inspector-agent";
import { OpsAgent } from "../../../src/agents/ops-agent";
import { LoopAgent } from "../../../src/agents/loop-agent";
import { Scheduler } from "../../../src/scheduler";
import { PipelineObserver } from "../../../src/pipeline-observer";
import { ConfirmGate } from "../../../src/confirm-gate";
import { Toolkit } from "../../../src/toolkit";
import { MemoryStore } from "../../../src/memory-store";
import { CLIAdapter } from "../../../src/cli-adapter";

// ══════════════════════════════════════════════�?
// 1. 环境变量
// ══════════════════════════════════════════════�?

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.error("�?.env 文件不存在，请在项目根目录创建并配置 DEEPSEEK_API_KEY");
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
// 2. 真实工具（只读安全）
// ══════════════════════════════════════════════�?

function registerRealTools(toolkit: Toolkit, workspaceRoot: string) {
  const resolve = (p: string) => path.resolve(workspaceRoot, p);

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
      const listing = entries
        .map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`)
        .join("\n");
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
    const outputDir = path.resolve(workspaceRoot, ".cortex", "e2e-output");
    if (!fp.startsWith(outputDir + path.sep)) {
      return { success: false, error: `write_file denied: 只能写入 .cortex/e2e-output/ 目录，禁止修改现有代码文件` };
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

  // run_shell �?安全执行，限�?workspace 范围，超�?60s，拦截危险命�?
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
        cwd: workspaceRoot,
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
// 3. 主流�?
// ══════════════════════════════════════════════�?

async function main() {
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) {
    console.error("�?DEEPSEEK_API_KEY 未设�?);
    process.exit(1);
  }

  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-reasoner";
  const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-v4-pro";
  const WORKSPACE = process.cwd();

  console.log("╔══════════════════════════════════════╗");
  console.log("�?  手动 E2E 快速验�?                  �?);
  console.log("╚══════════════════════════════════════╝\n");
  console.log(`  Model:  ${CHAT_MODEL} / ${REASONER_MODEL}`);
  console.log(`  CWD:    ${WORKSPACE}\n`);

  // ── 初始化组�?──
  console.log("🟢 初始化组�?..");

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
  const cliAdapter = new CLIAdapter();
  gate.setBridge(cliAdapter);

  const memory = new MemoryStore();
  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory.db");
  await memory.init(MEMORY_DB);
  console.log(`   �?MemoryStore 持久�? ${MEMORY_DB}`);

  pool.register({ type: AgentType.Code, maxInstances: 3 });
  pool.register({ type: AgentType.Review, maxInstances: 3 });
  pool.register({ type: AgentType.Analysis, maxInstances: 3 });
  pool.register({ type: AgentType.DocGovern, maxInstances: 3 });
  pool.register({ type: AgentType.Inspector, maxInstances: 3 });
  pool.register({ type: AgentType.Ops, maxInstances: 3 });
  pool.register({ type: AgentType.Loop, maxInstances: 3 });

  const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

  // ── 注册 Agent ──
  const codeToolkit = new Toolkit(gate);
  registerRealTools(codeToolkit, WORKSPACE);
  const codeAgent = new CodeAgent(adapter, codeToolkit, memory);
  await codeAgent.wakeup();
  scheduler.register(AgentType.Code, codeAgent, CHAT_MODEL);

  const reviewToolkit = new Toolkit(gate);
  registerRealTools(reviewToolkit, WORKSPACE);
  const reviewAgent = new ReviewAgent(adapter, reviewToolkit, memory);
  await reviewAgent.wakeup();
  scheduler.register(AgentType.Review, reviewAgent, CHAT_MODEL);

  const analysisToolkit = new Toolkit(gate);
  registerRealTools(analysisToolkit, WORKSPACE);
  const analysisAgent = new AnalysisAgent(adapter, analysisToolkit, memory);
  await analysisAgent.wakeup();
  scheduler.register(AgentType.Analysis, analysisAgent, CHAT_MODEL);

  const docGovernToolkit = new Toolkit(gate);
  registerRealTools(docGovernToolkit, WORKSPACE);
  const docGovernAgent = new DocGovernAgent(adapter, docGovernToolkit, memory);
  await docGovernAgent.wakeup();
  scheduler.register(AgentType.DocGovern, docGovernAgent, CHAT_MODEL);

  const inspectorToolkit = new Toolkit(gate);
  registerRealTools(inspectorToolkit, WORKSPACE);
  const inspectorAgent = new InspectorAgent(adapter, inspectorToolkit);
  await inspectorAgent.wakeup();
  scheduler.register(AgentType.Inspector, inspectorAgent, CHAT_MODEL);

  const opsToolkit = new Toolkit(gate);
  registerRealTools(opsToolkit, WORKSPACE);
  const opsAgent = new OpsAgent(adapter, opsToolkit);
  await opsAgent.wakeup();
  scheduler.register(AgentType.Ops, opsAgent, CHAT_MODEL);

  const loopToolkit = new Toolkit(gate);
  registerRealTools(loopToolkit, WORKSPACE);
  const loopAgent = new LoopAgent(adapter, loopToolkit);
  await loopAgent.wakeup();
  scheduler.register(AgentType.Loop, loopAgent, CHAT_MODEL);

  console.log("   �?7 Agent 就绪 (Code/Review/Analysis/DocGovern/Inspector/Ops/Loop)\n");

  // ── 规划 ──
  console.log("🟢 MetaAgent 规划...");

  const intent = [
    "�?测试环境约束：输出简洁，只读 packages/ �?docs/ 下的文件，不能修改代码�?,
    "",
    "检查项目的 package.json 有哪些依赖，",
    "然后列出 packages/engine/src 目录下有哪些 TypeScript 源文件�?,
  ].join("");

  const planStart = Date.now();
  const nodes = await metaAgent.plan(intent);
  const planDuration = Date.now() - planStart;

  console.log(`   �? 规划耗时: ${planDuration}ms`);
  console.log(`   节点�? ${nodes.length}`);
  for (const n of nodes) {
    console.log(`     [${n.type}] ${n.payload?.toString().slice(0, 80) ?? "?"}`);
    console.log(`       tags: [${n.tags.join(", ")}]  multi: ${n.needsMultiPerspective}`);
  }
  console.log();

  if (nodes.length === 0) {
    console.error("   �?MetaAgent 未产出节�?);
    process.exit(1);
  }

  // ── 入板 + 执行 ──
  console.log("🟢 �?TaskBoard + Scheduler 执行...");

  for (const n of nodes) board.addNode(n);
  console.log(`   �?${board.getAllNodes().length} 节点入板\n`);

  // 事件收集
  const events: Array<{ type: string; payload: unknown }> = [];
  observer.on(PipelinePriority.HIGH, (e) => {
    events.push({ type: e.type, payload: e.payload });
    const id = (e.payload as any)?.nodeId ?? "";
    console.log(`   📡 ${e.type}: ${id ? id : JSON.stringify(e.payload).slice(0, 80)}`);
  });

  const execStart = Date.now();
  const report = await scheduler.executeAll();
  const execDuration = Date.now() - execStart;

  console.log(`\n   �? 执行耗时: ${execDuration}ms`);
  console.log(`   完成: ${report.completed}  失败: ${report.failed}`);
  for (const r of report.results) {
    const icon = r.success ? "�? : "�?;
    console.log(`   ${icon} [${r.agentType ?? "?"}] ${r.nodeId}: ${(r.output ?? r.error ?? "?").slice(0, 100)}`);
  }
  console.log();

  // ── 诊断 ──
  console.log("╔══════════════════════════════════════╗");
  console.log("�?  诊断报告                            �?);
  console.log("╚══════════════════════════════════════╝\n");

  const allNodes = board.getAllNodes();
  const completedNodes = allNodes.filter((n) => n.status === "done");
  const failedNodes = allNodes.filter((n) => n.status === "failed");
  const memories = memory.read({});

  console.log("── 时序 ──");
  console.log(`  规划耗时:       ${planDuration}ms`);
  console.log(`  执行耗时:        ${execDuration}ms`);
  console.log(`  全管线耗时:      ${planDuration + execDuration}ms`);
  console.log();

  console.log("── 事件统计 ──");
  console.log(`  scheduler.layer.start:  ${events.filter((e) => e.type === "scheduler.layer.start").length}`);
  console.log(`  node.start:             ${events.filter((e) => e.type === "node.start").length}`);
  console.log(`  node.complete:          ${events.filter((e) => e.type === "node.complete").length}`);
  console.log(`  node.replan:            ${events.filter((e) => e.type === "node.replan").length}`);
  console.log(`  总事件数:                ${events.length}`);
  console.log();

  console.log("── TaskBoard ──");
  console.log(`  总节�?   ${allNodes.length}`);
  console.log(`  完成:     ${completedNodes.length}`);
  console.log(`  失败:     ${failedNodes.length}`);
  console.log(`  结果�?   ${allNodes.reduce((sum, n) => sum + n.results.length, 0)}`);
  console.log();

  console.log("── 记忆系统 ──");
  console.log(`  总条�?       ${memories.length}`);
  console.log(`  持久�?       ${memory.isPersisted ? "�?sql.js" : "�?仅内�?}`);
  console.log();

  // �?agentType 分组展示产出
  const results = allNodes.flatMap((n) => n.results);
  const byAgent = new Map<string, typeof results>();
  for (const r of results) {
    const key = r.agentType ?? "unknown";
    if (!byAgent.has(key)) byAgent.set(key, []);
    byAgent.get(key)!.push(r);
  }

  console.log("── �?Agent 产出 ──");
  byAgent.forEach((agentResults, agentType) => {
    console.log(`  [${agentType}] ${agentResults.length} 条结果`);
    for (const r of agentResults) {
      console.log(`     ${r.success ? "�? : "�?} ${(r.output ?? r.error ?? "").slice(0, 120)}`);
    }
  });
  console.log();

  // ── 结论 ──
  console.log("╔══════════════════════════════════════╗");
  console.log("�?  验证结论                            �?);
  console.log("╚══════════════════════════════════════╝\n");
  console.log(`  �?规划:     ${nodes.length} 节点 (${planDuration}ms)`);
  console.log(`  �?执行:     ${report.completed}/${nodes.length} 完成 (${execDuration}ms)`);
  console.log(`  �?记忆:     ${memories.length} �?(sql.js 持久�?`);
  console.log(`  �?事件:     ${events.length} 个`);

  if (report.failed > 0) {
    console.log(`\n  ⚠️  ${report.failed} �?Agent 结果标记为失败，详见日志`);
  } else {
    console.log(`\n  🎉 全链路通过`);
  }
  console.log();

  cliAdapter.close();
}

main().catch((err) => {
  console.error("�?验证失败:", err);
  process.exit(1);
});
