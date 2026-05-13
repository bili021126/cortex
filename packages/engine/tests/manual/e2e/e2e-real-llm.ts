/**
 * Core-1 v2.0 真实 LLM 全管�?E2E 验证
 *
 * 用法: npx tsx tests/manual/e2e-real-llm.ts
 * 前提: 项目根目�?.env 已配�?DEEPSEEK_API_KEY
 *
 * 验证链路 (v2.0 完整闭环):
 *   用户意图 �?MetaAgent 规划 �?CodeAgent 执行 �?ReviewAgent 审查
 *   �?DocGovernAgent 审计 �?ConfirmGate L2 确认 �?交付
 *   �?OpsAgent 编译/测试验证
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
// 1. 加载环境变量
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
// 2. 真实工具实现（只读安全）
// ══════════════════════════════════════════════�?

interface RealToolkit {
  registerReal(toolkit: Toolkit, workspaceRoot: string): void;
}

const REAL_TOOLS: RealToolkit = {
  registerReal(toolkit: Toolkit, workspaceRoot: string) {
    const resolve = (p: string) => path.resolve(workspaceRoot, p);

    // read_file
    toolkit.register("read_file", async (params) => {
      const fp = resolve(params.file_path as string);
      if (!fs.existsSync(fp)) return { success: false, error: `File not found: ${fp}` };
      try {
        const content = fs.readFileSync(fp, "utf-8");
        return { success: true, output: content };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    });

    // list_files �?Agent 标准工具名，params 对齐 TOOL_META（dir_path + pattern�?
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

    // search_code �?简�?grep（最大深�?4，文件上�?100KB�?
    toolkit.register("search_code", async (params) => {
      const query = (params.query ?? params.pattern ?? "") as string;
      const dir = resolve((params.path ?? ".") as string);
      if (!query) return { success: false, error: "Missing query/path" };
      const MAX_DEPTH = 4;
      const MAX_FILE_BYTES = 100 * 1024;
      try {
        const results: string[] = [];
        const walk = (d: string, depth: number) => {
          if (depth > MAX_DEPTH) return;
          for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
              walk(full, depth + 1);
            } else if (entry.isFile() && /\.(ts|js|json|md)$/.test(entry.name)) {
              const stat = fs.statSync(full);
              if (stat.size > MAX_FILE_BYTES) continue;
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

    // write_file �?固定输出�?.cortex/e2e-output/，禁止修改现有代�?
    toolkit.register("write_file", async (params) => {
      const fp = resolve(params.file_path as string);
      const outputDir = path.resolve(workspaceRoot, ".cortex", "e2e-output");
      // 只允许写�?.cortex/e2e-output/ 目录
      if (!fp.startsWith(outputDir + path.sep)) {
        return { success: false, error: `write_file denied: 只能写入 .cortex/e2e-output/ 目录，禁止修改现有代码文件。提交的路径: ${path.relative(workspaceRoot, fp)}` };
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
  },
};

// ══════════════════════════════════════════════�?
// 3. 主流�?
// ══════════════════════════════════════════════�?

async function main() {
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) { console.error("�?DEEPSEEK_API_KEY 未设�?); process.exit(1); }

  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-reasoner"; // V4-Flash 思考模�? 所�?Agent �?
  const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-v4-pro"; // MetaAgent 独享旗舰
  const WORKSPACE = process.cwd();

  console.log("╔══════════════════════════════════════╗");
  console.log("�? Core-1 v2.0 真实 LLM E2E 验证       �?);
  console.log("╚══════════════════════════════════════╝\n");
  console.log(`  Model:  ${CHAT_MODEL} / ${REASONER_MODEL}  [cache: on, reasoning: dynamic]`);
  console.log(`  Base:   ${BASE_URL}`);
  console.log(`  CWD:    ${WORKSPACE}\n`);

  // ── 3a. 初始化组�?──
  console.log("🟢 [Phase 1] 初始化组�?..");

  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    reasonerModel: REASONER_MODEL,
    reasoningEffort: "high", // MetaAgent 按标签智能分�?max，其�?high 提�?2-3x
  });
  adapter.setCacheEnabled(true); // 测试省钱：缓存相�?LLM 请求

  const metaAgent = new MetaAgent(adapter);
  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();
  const gate = new ConfirmGate();
  gate.bypassAll(); // E2E 测试模式：跳�?L2/L3 确认，专注验证行为链�?
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

  // 注入 CLIAdapter �?ConfirmGate，启用真实用户确认（L2/L3 操作�?stdin 交互�?
  const cliAdapter = new CLIAdapter();
  gate.setBridge(cliAdapter);
  console.log("   �?CLIAdapter 已注�?ConfirmGate\n");

  console.log("   �?组件就绪\n");

  // ── 3b. 注册真实工具 ──
  console.log("🟢 [Phase 2] 注册真实工具...");

  const codeToolkit = new Toolkit(gate);
  REAL_TOOLS.registerReal(codeToolkit, WORKSPACE);
  const codeAgent = new CodeAgent(adapter, codeToolkit, memory);
  await codeAgent.wakeup();
  scheduler.register(AgentType.Code, codeAgent, CHAT_MODEL);

  const reviewToolkit = new Toolkit(gate);
  REAL_TOOLS.registerReal(reviewToolkit, WORKSPACE);
  const reviewAgent = new ReviewAgent(adapter, reviewToolkit, memory);
  await reviewAgent.wakeup();
  scheduler.register(AgentType.Review, reviewAgent, CHAT_MODEL);

  const analysisToolkit = new Toolkit(gate);
  REAL_TOOLS.registerReal(analysisToolkit, WORKSPACE);
  const analysisAgent = new AnalysisAgent(adapter, analysisToolkit, memory);
  await analysisAgent.wakeup();
  scheduler.register(AgentType.Analysis, analysisAgent, CHAT_MODEL);

  // DocGovernAgent —�?只读工具，审计文档合规�?
  const docGovernToolkit = new Toolkit(gate);
  REAL_TOOLS.registerReal(docGovernToolkit, WORKSPACE);
  const docGovernAgent = new DocGovernAgent(adapter, docGovernToolkit, memory);
  await docGovernAgent.wakeup();
  scheduler.register(AgentType.DocGovern, docGovernAgent, CHAT_MODEL);

  // InspectorAgent —�?纯事实采集，只读工具
  const inspectorToolkit = new Toolkit(gate);
  REAL_TOOLS.registerReal(inspectorToolkit, WORKSPACE);
  const inspectorAgent = new InspectorAgent(adapter, inspectorToolkit);
  await inspectorAgent.wakeup();
  scheduler.register(AgentType.Inspector, inspectorAgent, CHAT_MODEL);

  // OpsAgent —�?编译/测试/部署，run_shell + write_file
  const opsToolkit = new Toolkit(gate);
  REAL_TOOLS.registerReal(opsToolkit, WORKSPACE);
  const opsAgent = new OpsAgent(adapter, opsToolkit);
  await opsAgent.wakeup();
  scheduler.register(AgentType.Ops, opsAgent, CHAT_MODEL);

  // LoopAgent —�?模式提炼（只读）
  const loopToolkit = new Toolkit(gate);
  REAL_TOOLS.registerReal(loopToolkit, WORKSPACE);
  const loopAgent = new LoopAgent(adapter, loopToolkit);
  await loopAgent.wakeup();
  scheduler.register(AgentType.Loop, loopAgent, CHAT_MODEL);

  console.log("   �?read_file / list_files / search_code / write_file / run_shell 就绪\n");

  // ── 3c. 规划 ──
  console.log("🟢 [Phase 3] MetaAgent 规划...");

  const intent = [
    "�?测试环境约束：所�?Agent 输出简洁，只读 packages/ �?docs/ 下的文件，CodeAgent/OpsAgent 写文件限�?.cortex/e2e-output/，禁止修改任何现有代码�?,
    "",
    "🏠 回家看看——探�?Cortex 工具链这个「家」�?,
    "",
    "- 探针，去 packages/engine/src/ 转一圈，搞清楚家里每个房间（模块）是干什么的、怎么串起来的�?,
    "- 铁锤，看看家里工具箱里有什么（Toolkit 注册了哪些工具）。分析完让阿贝多（CodeAgent）在 .cortex/e2e-output/ 里添个实用的小物件——只能写新文件，不能碰现有代码�?,
    "- 北斗（OpsAgent），�?.cortex/e2e-output/ 里阿贝多刚写的东西拿去编译测试——跑 tsc 检查类型，再跑 pnpm test 验证，报告通过/失败�?,
    "- 鹰眼，巡视一遍刚动过的地方，看有没有墙皮掉了、线路搭错了、风格不统一�?,
    "- 法典，把家规（宪�?Constitution）翻出来，看看现在家里有没有违规的地方�?,
  ].join("\n");
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

  // ── 3d. 入板 ──
  console.log("🟢 [Phase 4] �?TaskBoard...");
  for (const n of nodes) {
    board.addNode(n);
  }
  console.log(`   �?${board.getAllNodes().length} 节点入板\n`);

  // 订阅事件看进�?
  observer.on(PipelinePriority.HIGH, (e) => {
    console.log(`   📡 ${e.type}: ${JSON.stringify((e.payload as any).nodeId ?? e.payload).slice(0, 100)}`);
  });

  // ── 3e. 执行 ──
  console.log("🟢 [Phase 5] Scheduler 执行...");
  const execStart = Date.now();
  const report = await scheduler.executeAll();
  const execDuration = Date.now() - execStart;

  console.log(`   �? 执行耗时: ${execDuration}ms`);
  console.log(`   完成: ${report.completed}  失败: ${report.failed}`);
  for (const r of report.results) {
    const icon = r.success ? "�? : "�?;
    const preview = (r.output ?? r.error ?? "?").slice(0, 100);
    console.log(`   ${icon} [${r.agentType ?? "?"}] ${r.nodeId}: ${preview}`);
  }
  console.log();

  // ── 3f. 诊断 ──
  console.log("🟢 [Phase 6] 诊断数据...");
  const allNodes = board.getAllNodes();
  const completedNodes = allNodes.filter((n) => n.status === "done");
  const failedNodes = allNodes.filter((n) => n.status === "failed");
  const memories = memory.read({});

  console.log(`   TaskBoard: ${allNodes.length} nodes (${completedNodes.length} done, ${failedNodes.length} failed)`);
  console.log(`   MemoryStore: ${memories.length} �? [持久�? ${memory.isPersisted ? "�?sql.js" : "�?仅内�?}]`);
  
  for (const n of completedNodes) {
    for (const r of n.results) {
      const agentLabel = r.agentType === AgentType.DocGovern ? "📋 DocGovern" : `📝 [${r.agentType}]`;
      console.log(`   ${agentLabel} ${n.id}: ${(r.output ?? "").slice(0, 120)}`);
    }
  }
  
  // DocGovernAgent 审计摘要
  const docGovernResults = allNodes.flatMap((n) => n.results).filter((r) => r.agentType === AgentType.DocGovern);
  if (docGovernResults.length > 0) {
    console.log(`\n   📋 DocGovernAgent 审计产出:`);
    for (const dr of docGovernResults) {
      console.log(`      ${(dr.output ?? "").slice(0, 200)}`);
    }
  }

  const totalDuration = execStart - planStart + execDuration;

  console.log("\n╔══════════════════════════════════════╗");
  console.log("�?  E2E 验证结论                        �?);
  console.log("╚══════════════════════════════════════╝\n");
  console.log(`  �?MetaAgent 规划: ${nodes.length} 节点 (${planDuration}ms)`);
  console.log(`  �?Scheduler 执行: ${report.completed}/${nodes.length} 完成 (${execDuration}ms)`);
  console.log(`  �?记忆写入: ${memories.length} 条`);
  console.log(`  �?全管线耗时: ${totalDuration}ms`);
  console.log();

  if (report.failed > 0) {
    console.log("  ⚠️  有部分节点失败，详见上方日志\n");
  }

  cliAdapter.close();
}

main().catch((err) => {
  console.error("�?E2E 失败:", err);
  process.exit(1);
});
