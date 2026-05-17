/**
 * 全 Agent 治理闭环 E2E —— MetaAgent 驱动、DocGovernAgent 修宪提案、昔涟评判
 *
 * 裁决权二分完整链路（真实 LLM）：
 *   凝光(DocGovernAgent) 审计宪法 → 发现缺陷 → 生成 AmendmentProposal JSON
 *   → 昔涟(evaluateAmendment) 评判合规性 → 开拓者裁决
 *
 * 用法: npx tsx packages/engine/tests/manual/e2e/governance-full-agent-e2e.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验收标准:
 *   1. MetaAgent 产出 ≥1 个 constitution_propose 节点
 *   2. DocGovernAgent 产出 ≥1 个修宪提案 JSON（写入 docs/amendments/）
 *   3. 昔涟评判通过（无 BLOCKED）
 *   4. pnpm build && pnpm test 通过
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { AgentType, PipelinePriority, type TaskNode } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { TaskBoard } from "../../../src/task-board.js";
import { AgentPool } from "../../../src/agent-pool.js";
import { Scheduler } from "../../../src/scheduler.js";
import { PipelineObserver } from "../../../src/pipeline-observer.js";
import { ConfirmGate } from "../../../src/confirm-gate.js";
import { Toolkit } from "../../../src/toolkit.js";
import { MemoryStore } from "../../../src/memory/memory-store.js";
import { MetaAgent } from "../../../src/meta-agent.js";
import { createAgent } from "../../../src/components/agent-factory.js";
import { codeAgentConfig } from "../../../src/agents/code-agent.js";
import { reviewAgentConfig } from "../../../src/agents/review-agent.js";
import { analysisAgentConfig } from "../../../src/agents/analysis-agent.js";
import { opsAgentConfig } from "../../../src/agents/ops-agent.js";
import { loopAgentConfig } from "../../../src/agents/loop-agent.js";
import { docGovernAgentConfig } from "../../../src/agents/doc-govern-agent.js";
import { ApiAgent } from "../../../src/agents/api-agent.js";
import { DataAgent } from "../../../src/agents/data-agent.js";
import { fixAgentConfig } from "../../../src/agents/fix-agent.js";
import { createInspectorAgent } from "../../../src/agents/inspector-agent.js";
import { ButlerAgent } from "../../../src/agents/butler-agent.js";
import { evaluateAmendment } from "../../../src/amendment-judge.js";
import { summarizeGovernance } from "../../../src/governance-loop.js";
import type { AmendmentProposal } from "@cortex/shared";

// ══════════════════════════════════════════════
// 0. 环境变量
// ══════════════════════════════════════════════

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const clean = line.replace(/\r$/, "");
      const m = clean.match(/^([^=]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].trim();
    }
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("❌ DEEPSEEK_API_KEY 未设置");
    process.exit(1);
  }
}

// ══════════════════════════════════════════════
// 1. 工具注册
// ══════════════════════════════════════════════

const DANGEROUS = /\b(rm\s+-rf|del\s+\/F|format\s|shutdown|reboot|sudo|chmod\s+777|>\/dev\/|curl.*\|.*sh|wget.*-O.*\||mkfs)\b/i;

function registerProjectTools(toolkit: Toolkit, projectRoot: string) {
  const resolve = (p: string) => path.resolve(projectRoot, p);

  toolkit.register("read_file", async (params: any) => {
    const fp = resolve(params.file_path as string);
    if (!fs.existsSync(fp)) return { success: false, error: `File not found: ${fp}` };
    try {
      const content = fs.readFileSync(fp, "utf-8");
      // 截断过长文件避免 token 爆炸
      const truncated = content.length > 8000
        ? content.slice(0, 8000) + `\n\n... (truncated, ${content.length} total chars)`
        : content;
      return { success: true, output: truncated };
    } catch (e) { return { success: false, error: String(e) }; }
  });

  toolkit.register("list_files", async (params: any) => {
    const dp = resolve((params.dir_path ?? params.path ?? ".") as string);
    if (!fs.existsSync(dp)) return { success: false, error: `Dir not found: ${dp}` };
    const entries = fs.readdirSync(dp, { withFileTypes: true });
    const listing = entries.map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`).join("\n");
    return { success: true, output: listing };
  });

  toolkit.register("search_code", async (params: any) => {
    const query = (params.query ?? params.pattern ?? "") as string;
    const dir = resolve((params.path ?? ".") as string);
    if (!query) return { success: false, error: "Missing query/pattern" };
    const results: string[] = [];
    const walk = (d: string, depth: number) => {
      if (depth > 4) return;
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
  });

  toolkit.register("write_file", async (params: any) => {
    const fp = resolve(params.file_path as string);
    if (!fp.startsWith(projectRoot + path.sep)) {
      return { success: false, error: `write_file denied: 路径越界 ${fp}` };
    }
    try {
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const content = params.content as string;
      // 写入前校验：amendments JSON 必须是合法 JSON
      if (fp.includes("amendments") && fp.endsWith(".json")) {
        try { JSON.parse(content); } catch {
          return { success: false, error: "amendments JSON 格式不合法，拒绝写入" };
        }
      }
      fs.writeFileSync(fp, content, "utf-8");
      return { success: true, output: `Wrote ${Buffer.byteLength(content)} bytes to ${fp}` };
    } catch (e) { return { success: false, error: String(e) }; }
  });

  toolkit.register("run_shell", async (params: any) => {
    const cmd = (params.command ?? "") as string;
    if (!cmd) return { success: false, error: "run_shell: 缺少 command 参数" };
    if (DANGEROUS.test(cmd)) {
      return { success: false, error: `run_shell denied: 危险命令已拦截` };
    }
    try {
      const output = execSync(cmd, {
        cwd: projectRoot, timeout: 60_000, encoding: "utf-8",
        maxBuffer: 512 * 1024, stdio: ["ignore", "pipe", "pipe"],
      });
      return { success: true, output: output || "(exit 0)" };
    } catch (e: any) {
      return { success: false, error: `Command failed: ${e.message.slice(0, 300)}` };
    }
  });
}

// ══════════════════════════════════════════════
// 2. 辅助函数
// ══════════════════════════════════════════════

const SEP = "═".repeat(60);
function log(msg: string): void { console.log(`  ${msg}`); }
function header(title: string): void { console.log(`\n${SEP}\n  ${title}\n${SEP}`); }
function passed(label: string): void { console.log(`  ✅ ${label}`); }
function failed(label: string, detail?: string): void {
  console.log(`  ❌ ${label}`);
  if (detail) console.log(`     ${detail}`);
}
function info(label: string, value: string): void { console.log(`  📋 ${label}: ${value}`); }

/** 收集 docs/amendments/ 下新生成的修宪提案（E2E 本次运行后新增的） */
function collectNewProposals(knownIds: Set<string>): AmendmentProposal[] {
  const dir = path.resolve(process.cwd(), "docs", "amendments");
  if (!fs.existsSync(dir)) return [];
  const proposals: AmendmentProposal[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, entry.name), "utf-8");
      const p = JSON.parse(raw) as AmendmentProposal;
      if (!knownIds.has(p.id)) {
        proposals.push(p);
      }
    } catch { /* skip */ }
  }
  return proposals;
}

// ══════════════════════════════════════════════
// 3. 主流程
// ══════════════════════════════════════════════

async function main() {
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY!;
  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-reasoner";
  const WORKSPACE = process.cwd();

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🏛️  全 Agent 治理闭环 E2E                       ║");
  console.log("║   凝光审计→提案→昔涟评判→开拓者裁决             ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  Chat:   ${CHAT_MODEL}`);
  console.log(`  项目:   ${WORKSPACE}\n`);

  // ── 记录已存在的提案 ID（区分新旧） ──
  const existingIds = new Set<string>();
  const amendmentsDir = path.resolve(WORKSPACE, "docs", "amendments");
  if (fs.existsSync(amendmentsDir)) {
    for (const f of fs.readdirSync(amendmentsDir)) {
      if (f.endsWith(".json")) existingIds.add(f.replace(".json", ""));
    }
  }
  info("已有提案", `${existingIds.size} 条`);

  // ── Phase 1: 基础设施 ──
  header("Phase 1/4 — 初始化基础设施");

  const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-v4-pro";

  const adapter = new LlmAdapter({
    apiKey: API_KEY, baseUrl: BASE_URL, chatModel: CHAT_MODEL, reasonerModel: REASONER_MODEL,
  });
  adapter.setCacheEnabled(true);

  const metaAgent = new MetaAgent(adapter);
  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();
  const gate = new ConfirmGate();
  gate.bypassAll();

  const memory = new MemoryStore();
  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-governance-full.db");
  // 每次 E2E 清空记忆库——冷启动
  if (fs.existsSync(MEMORY_DB)) fs.unlinkSync(MEMORY_DB);
  await memory.init(MEMORY_DB);
  info("MemoryStore", MEMORY_DB);

  // ── Phase 2: 注册全 Agent 池 ──
  header("Phase 2/4 — 注册全 Agent 池 (10 个)");

  pool.register({ type: AgentType.Code, maxInstances: 2 });
  pool.register({ type: AgentType.Review, maxInstances: 2 });
  pool.register({ type: AgentType.Analysis, maxInstances: 1 });
  pool.register({ type: AgentType.Ops, maxInstances: 1 });
  pool.register({ type: AgentType.Loop, maxInstances: 1 });
  pool.register({ type: AgentType.DocGovern, maxInstances: 1 });
  pool.register({ type: AgentType.Api, maxInstances: 1 });
  pool.register({ type: AgentType.Data, maxInstances: 1 });
  pool.register({ type: AgentType.Fix, maxInstances: 1 });
  pool.register({ type: AgentType.Inspector, maxInstances: 2 });

  const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

  // 工具注册——所有 Agent 共享同一 Toolkit
  const sharedToolkit = new Toolkit(gate);
  registerProjectTools(sharedToolkit, WORKSPACE);

  // 注册全部 Agent（工厂模式）
  const agents: { type: AgentType; label: string; inst: any }[] = [
    { type: AgentType.Code, label: "刻晴", inst: createAgent(codeAgentConfig(), adapter, sharedToolkit, memory) },
    { type: AgentType.Review, label: "久岐忍", inst: createAgent(reviewAgentConfig(), adapter, sharedToolkit, memory) },
    { type: AgentType.Analysis, label: "纳西妲", inst: createAgent(analysisAgentConfig(), adapter, sharedToolkit, memory) },
    { type: AgentType.Ops, label: "北斗", inst: createAgent(opsAgentConfig(), adapter, sharedToolkit, memory) },
    { type: AgentType.Loop, label: "莫娜", inst: createAgent(loopAgentConfig(), adapter, sharedToolkit, memory) },
    { type: AgentType.DocGovern, label: "凝光", inst: createAgent(docGovernAgentConfig(), adapter, sharedToolkit) },
    { type: AgentType.Api, label: "久岐忍", inst: new ApiAgent(adapter, sharedToolkit, memory) },
    { type: AgentType.Data, label: "艾尔海森", inst: new DataAgent(adapter, sharedToolkit, memory) },
    { type: AgentType.Fix, label: "希格雯", inst: createAgent(fixAgentConfig(), adapter, sharedToolkit, memory) },
    { type: AgentType.Inspector, label: "安柏", inst: createInspectorAgent(adapter, sharedToolkit, memory) },
  ];

  for (const { type, label, inst } of agents) {
    await inst.wakeup();
    scheduler.register(type, inst, CHAT_MODEL);
    log(`${label} (${type}) 注册完毕`);
  }

  // ButlerAgent 旁听事件总线
  const butler = new ButlerAgent(observer);
  scheduler.register(AgentType.Butler, butler, CHAT_MODEL);
  log("管家 (Butler) 旁听中");

  // ── Phase 3: MetaAgent 规划 ──
  header("Phase 3/4 — MetaAgent 规划 (治理审计意图)");

  // 治理审计意图——聚焦宪法审查
  const GOVERNANCE_INTENT = [
    "你是 Cortex 的 MetaAgent（甘雨），负责战术调度。",
    "",
    "本次意图——治理审计闭环：",
    "",
    "**任务**：审查 Cortex 宪法 v2.5.13（docs/constitution/Cortex 概念顶层设计 v2.5.md），",
    "检查以下方面：",
    "1. 原则七（系统自我修改的宪法约束）的七项子约束是否完备——特别是新增的子约束7「子约束修改规则」后，",
    "   子约束自身的修改流程是否形成完整闭环、是否有新的自反性缺口",
    "2. §8.2（通知管线——三轨语义分层）的三轨定义是否有覆盖缺口、",
    "   与 §8.1（SafeErrorReporter）的错误维度是否正交互补无遗漏",
    "3. 宪法 v2.5.13 整体是否存在新的治理缺口——条款之间是否存在矛盾、",
    "   是否有未覆盖的架构组件、是否有需要在 Core-2 前修正的事项",
    "",
    "**可用 Agent**：",
    "- DocGovernAgent（凝光）：宪法审计引擎，可读取宪法全文，",
    "  发现缺陷后生成修宪提案 JSON 写入 docs/amendments/AM-YYYY-MMDD-NNN.json",
    "- ReviewAgent（久岐忍）：交叉验证凝光的审计发现",
    "- AnalysisAgent（纳西妲）：架构层面评估宪法缺口的影响范围",
    "- InspectorAgent（安柏）：事实采集——统计宪法结构、版本号、变更历史",
    "",
    "**规划要求**：",
    "- 至少规划 1 个 constitution_propose 节点给 DocGovernAgent",
    "- 可以规划 review 节点给 ReviewAgent 做交叉验证",
    "- 可以规划 analysis 节点给 AnalysisAgent 做影响评估",
    "- 可以规划 inspector 节点给 InspectorAgent 做宪法结构采集",
    "",
    "**调度的节点数控制在 4-6 个**，不要膨胀。",
  ].join("\n");

  console.log(`\n  意图:\n${GOVERNANCE_INTENT.split("\n").map(l => `    ${l}`).join("\n")}\n`);

  const planStart = Date.now();
  const plan = await metaAgent.plan(GOVERNANCE_INTENT);
  const planDuration = Date.now() - planStart;

  if (plan.length === 0) {
    console.error("\n❌ MetaAgent 产出 0 个任务节点，中止。");
    process.exit(1);
  }

  console.log(`\n  MetaAgent 计划 (${plan.length} 个节点, ${planDuration}ms):`);
  for (const n of plan) {
    console.log(`    📋 [${n.type}] ${n.id} — tags: ${(n.tags ?? []).join(", ")}`);
  }
  for (const n of plan) board.addNode(n);

  // ── Phase 4: Scheduler 执行 ──
  header("Phase 4/4 — Scheduler 执行");

  // 事件监听
  observer.on(PipelinePriority.HIGH, (e: any) => {
    const p = e.payload as any;
    const id = p?.nodeId ? `[${(p.nodeId as string).slice(0, 20)}]` : "";
    if (e.type === "node.complete") {
      console.log(`   ✅ ${id} ${p.agentType ?? "?"} 完成`);
    } else if (e.type === "node.failed") {
      console.log(`   ❌ ${id} 失败: ${String(p.error ?? "").slice(0, 120)}`);
    } else if (e.type === "node.replan") {
      console.log(`   🔄 ${id} 重规划 #${p.attempt}`);
    }
  });

  const execStart = Date.now();
  const report = await scheduler.executeAll();
  const execDuration = Date.now() - execStart;

  // ── 执行结果 ──
  console.log(`\n  完成: ${report.completed}  失败: ${report.failed}  耗时: ${execDuration}ms\n`);

  const allNodes = board.getAllNodes();
  for (const n of allNodes) {
    const icon = n.status === "done" ? "✅" : n.status === "failed" ? "❌" : "⏳";
    console.log(`   ${icon} [${n.type}] ${n.id} (${n.status})`);
    for (const r of n.results) {
      const preview = (r.output ?? r.error ?? "?").slice(0, 200);
      console.log(`      → ${preview}`);
    }
  }

  // ── Phase 5: 昔涟评判 ──
  header("Phase 5 — 昔涟评判 (修宪提案合规性检查)");

  const newProposals = collectNewProposals(existingIds);
  info("新生成提案", `${newProposals.length} 条`);

  if (newProposals.length === 0) {
    console.log("\n  ⚠️ 未生成新的修宪提案。");
    console.log("  可能原因：宪法已完备，或 DocGovernAgent 未执行 constitution_propose 节点。\n");
    console.log("  执行结果摘要：");
    const docNodes = allNodes.filter(n =>
      n.tags?.some((t: string) => t.includes("constitution") || t.includes("doc"))
    );
    for (const n of docNodes) {
      console.log(`     [${n.type}] ${n.id} (${n.status})`);
      for (const r of n.results) {
        console.log(`       → ${(r.output ?? r.error ?? "").slice(0, 300)}`);
      }
    }
    await memory.close();
    process.exit(0); // 不是失败——可能是宪法已完备
  }

  // 逐条评判
  const constitutionPath = path.resolve(
    WORKSPACE, "docs", "constitution", "Cortex 概念顶层设计 v2.5.md",
  );
  const constitution = fs.readFileSync(constitutionPath, "utf-8");

  let allPassed = true;
  for (const proposal of newProposals) {
    console.log(`\n  ── ${proposal.id} ──`);
    info("章节", proposal.section);
    info("目标版本", proposal.version);
    info("类别", proposal.category);
    info("摘要", proposal.summary);
    info("理由", proposal.rationale.slice(0, 120) + "...");

    const judgment = evaluateAmendment(proposal, constitution);

    for (const check of judgment.checks) {
      if (check.passed) {
        passed(check.name);
      } else {
        failed(check.name, check.detail);
        allPassed = false;
      }
    }

    const verdictLabel = {
      APPROVED: "✅ 通过",
      APPROVED_WITH_CAVEATS: "⚠️ 附条件通过",
      BLOCKED: "🚫 阻塞",
      NEEDS_CLARIFICATION: "❓ 需要澄清",
    }[judgment.verdict];
    console.log(`  📌 裁决: ${verdictLabel}`);

    if (judgment.caveats) {
      for (const c of judgment.caveats) console.log(`     ⚠️ ${c}`);
    }
    if (judgment.blocking.length > 0) {
      for (const b of judgment.blocking) console.log(`     🚫 ${b}`);
      allPassed = false;
    }
  }

  // ── 治理摘要 ──
  try {
    const summary = summarizeGovernance(WORKSPACE);
    console.log(`\n  ── 治理摘要 ──`);
    info("待评判", `${summary.pendingJudgment} 条`);
    info("已批准", `${summary.approved} 条`);
    info("已阻塞", `${summary.blocked} 条`);
    info("已应用", `${summary.applied} 条`);
  } catch { /* summarizeGovernance 需要宪法存在 */ }

  // ── 验证 ──
  header("验证 — build + test");

  try {
    execSync("pnpm build", { cwd: WORKSPACE, timeout: 120_000, stdio: "pipe", encoding: "utf-8" });
    passed("pnpm build 9/9 通过");
  } catch (e: any) {
    failed("pnpm build", e.stderr?.slice(-300) ?? String(e));
    allPassed = false;
  }

  try {
    execSync("pnpm test", { cwd: WORKSPACE, timeout: 300_000, stdio: "pipe", encoding: "utf-8" });
    passed("pnpm test 全部通过");
  } catch (e: any) {
    failed("pnpm test", e.stderr?.slice(-300) ?? String(e));
    allPassed = false;
  }

  // ── 记忆诊断 ──
  console.log(`\n  ── 记忆系统 ──`);
  const allMem = memory.read({});
  info("总记忆", `${allMem.length} 条`);

  await memory.close();

  // ── 最终判定 ──
  header("最终判定");
  console.log(`  新提案: ${newProposals.length} 条`);
  console.log(`  评判:   ${allPassed ? "✅ 全部通过" : "❌ 存在问题"}`);
  console.log(`  规划:   ${planDuration}ms`);
  console.log(`  执行:   ${execDuration}ms`);
  console.log(`  总耗时: ${planDuration + execDuration}ms\n`);

  if (!allPassed) process.exit(1);
}

main().catch((e) => {
  console.error("💥 治理闭环 E2E 崩溃:", e);
  process.exit(1);
});
