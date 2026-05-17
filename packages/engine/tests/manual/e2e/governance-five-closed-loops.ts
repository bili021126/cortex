/**
 * 五环联动 全闭合自演进 E2E —— 多轮迭代直至宪法收敛
 *
 * 五环：
 *   执行闭环 —— Scheduler 调度 → Agent 执行 → 结果反馈 → 下一轮规划
 *   认知闭环 —— 执行结果 → MemoryStore 跨轮累积 → Agent 查阅记忆 → 更优决策
 *   治理闭环 —— 审计 → 提案 → 昔涟评判 → 开拓者裁决 → 写入宪法
 *   自我演进闭环 —— 发现代码缺陷 → FixAgent 修复 → build+test 验证
 *   自主修宪闭环 —— DocGovernAgent 发现宪法缺口 → 生成提案 → auto-judge → auto-apply
 *
 * 用法: npx tsx packages/engine/tests/manual/e2e/governance-five-closed-loops.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
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
import { applyAmendment } from "../../../src/amendment-applier.js";
import { summarizeGovernance } from "../../../src/governance-loop.js";
import type { AmendmentProposal } from "@cortex/shared";

// ══════════════════════════════════════════════
// 0. 环境与常量
// ══════════════════════════════════════════════

const SEP = "═".repeat(60);
const DANGEROUS = /\b(rm\s+-rf|del\s+\/F|format\s|shutdown|reboot|sudo|chmod\s+777|>\/dev\/|curl.*\|.*sh|wget.*-O.*\||mkfs)\b/i;
const MAX_ITERATIONS = 3;

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

function log(msg: string): void { console.log(`  ${msg}`); }
function header(title: string): void { console.log(`\n${SEP}\n  ${title}\n${SEP}`); }
function passed(label: string): void { console.log(`  ✅ ${label}`); }
function failed(label: string, detail?: string): void {
  console.log(`  ❌ ${label}`);
  if (detail) console.log(`     ${detail}`);
}
function info(label: string, value: string): void { console.log(`  📋 ${label}: ${value}`); }
function warn(label: string): void { console.log(`  ⚠️  ${label}`); }

// ══════════════════════════════════════════════
// 1. 工具注册
// ══════════════════════════════════════════════

function registerProjectTools(toolkit: Toolkit, projectRoot: string) {
  const resolve = (p: string) => path.resolve(projectRoot, p);

  toolkit.register("read_file", async (params: any) => {
    const fp = resolve(params.file_path as string);
    if (!fs.existsSync(fp)) return { success: false, error: `File not found: ${fp}` };
    try {
      const content = fs.readFileSync(fp, "utf-8");
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

  // 精确宪法读取——用于修宪提案生成（before 字段必须逐字匹配）
  toolkit.register("read_constitution_exact", async (params: any) => {
    const conPath = resolve("docs/constitution/Cortex 概念顶层设计 v2.5.md");
    if (!fs.existsSync(conPath)) return { success: false, error: "宪法文件不存在" };
    const content = fs.readFileSync(conPath, "utf-8");
    const section = params.section as string | undefined;
    const startLine = params.start_line as number | undefined;
    const endLine = params.end_line as number | undefined;

    if (startLine != null && endLine != null) {
      const lines = content.split("\n");
      const excerpt = lines.slice(startLine - 1, endLine).join("\n");
      return {
        success: true,
        output: excerpt,
        lines: `${startLine}-${endLine}`,
        totalLines: lines.length,
        warning: "⚠️ 以下为宪法原文的精确副本。修宪提案的 before 字段必须逐字引用此输出，不得改写、不得概括、不得添加省略号。",
      };
    }

    if (section) {
      const lines = content.split("\n");
      const matches: { line: number; text: string }[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(section)) {
          // 返回匹配行及其上下文（前后各5行）
          const start = Math.max(0, i - 5);
          const end = Math.min(lines.length, i + 6);
          const excerpt = lines.slice(start, end).join("\n");
          matches.push({ line: i + 1, text: excerpt });
          if (matches.length >= 10) break;
        }
      }
      if (matches.length === 0) return { success: false, error: `在宪法中未找到匹配 "${section}" 的段落` };
      return {
        success: true,
        output: matches.map(m => `[行${m.line}]\n${m.text}`).join("\n\n---\n\n"),
        matchCount: matches.length,
        warning: "⚠️ 以下为宪法原文的精确副本。修宪提案的 before 字段必须逐字引用此输出，不得改写、不得概括、不得添加省略号。",
      };
    }

    return { success: false, error: "请提供 section（搜索关键词）或 start_line+end_line（行号范围）参数" };
  });
}

// ══════════════════════════════════════════════
// 2. 辅助函数
// ══════════════════════════════════════════════

function readConstitutionVersion(workspace: string): string {
  const conPath = path.resolve(workspace, "docs", "constitution", "Cortex 概念顶层设计 v2.5.md");
  if (!fs.existsSync(conPath)) return "unknown";
  const content = fs.readFileSync(conPath, "utf-8");
  const m = content.match(/\*\*版本\*\*[：:]\s*(v[\d.]+)/);
  return m?.[1] ?? "unknown";
}

function collectNewProposals(knownIds: Set<string>, workspace: string): AmendmentProposal[] {
  const dir = path.resolve(workspace, "docs", "amendments");
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
// 3. 初始化基础设施（一次性，跨轮复用）
// ══════════════════════════════════════════════

interface Infra {
  workspace: string;
  adapter: LlmAdapter;
  metaAgent: MetaAgent;
  board: TaskBoard;
  pool: AgentPool;
  observer: PipelineObserver;
  gate: ConfirmGate;
  scheduler: Scheduler;
  memory: MemoryStore;
  sharedToolkit: Toolkit;
  chatModel: string;
  knownProposalIds: Set<string>;
}

async function setupOnce(): Promise<Infra> {
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY!;
  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-reasoner";
  const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-v4-pro";
  const WORKSPACE = process.cwd();

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
  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-five-loops.db");
  if (fs.existsSync(MEMORY_DB)) fs.unlinkSync(MEMORY_DB); // 冷启动——但跨轮不清理
  await memory.init(MEMORY_DB);

  // 注册全部 AgentType
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

  // 共享 Toolkit
  const sharedToolkit = new Toolkit(gate);
  registerProjectTools(sharedToolkit, WORKSPACE);

  // 注册全部 Agent 实例（工厂模式）
  const agentConfigs: { type: AgentType; label: string; inst: any }[] = [
    { type: AgentType.Code, label: "阿贝多", inst: createAgent(codeAgentConfig(), adapter, sharedToolkit, memory) },
    { type: AgentType.Review, label: "刻晴", inst: createAgent(reviewAgentConfig(), adapter, sharedToolkit, memory) },
    { type: AgentType.Analysis, label: "纳西妲", inst: createAgent(analysisAgentConfig(), adapter, sharedToolkit, memory) },
    { type: AgentType.Ops, label: "北斗", inst: createAgent(opsAgentConfig(), adapter, sharedToolkit, memory) },
    { type: AgentType.Loop, label: "莫娜", inst: createAgent(loopAgentConfig(), adapter, sharedToolkit, memory) },
    { type: AgentType.DocGovern, label: "凝光", inst: createAgent(docGovernAgentConfig(), adapter, sharedToolkit) },
    { type: AgentType.Api, label: "久岐忍", inst: new ApiAgent(adapter, sharedToolkit, memory) },
    { type: AgentType.Data, label: "艾尔海森", inst: new DataAgent(adapter, sharedToolkit, memory) },
    { type: AgentType.Fix, label: "希格雯", inst: createAgent(fixAgentConfig(), adapter, sharedToolkit, memory) },
    { type: AgentType.Inspector, label: "安柏", inst: createInspectorAgent(adapter, sharedToolkit, memory) },
  ];

  for (const { type, label, inst } of agentConfigs) {
    await inst.wakeup();
    scheduler.register(type, inst, CHAT_MODEL);
  }

  // ButlerAgent 旁听
  const butler = new ButlerAgent(observer);
  scheduler.register(AgentType.Butler, butler, CHAT_MODEL);

  // 记录初始提案 ID
  const knownProposalIds = new Set<string>();
  const amendmentsDir = path.resolve(WORKSPACE, "docs", "amendments");
  if (fs.existsSync(amendmentsDir)) {
    for (const f of fs.readdirSync(amendmentsDir)) {
      if (f.endsWith(".json")) knownProposalIds.add(f.replace(".json", ""));
    }
  }

  return {
    workspace: WORKSPACE, adapter, metaAgent, board, pool, observer, gate,
    scheduler, memory, sharedToolkit, chatModel: CHAT_MODEL, knownProposalIds,
  };
}

// ══════════════════════════════════════════════
// 4. 单轮迭代
// ══════════════════════════════════════════════

interface RoundResult {
  round: number;
  planDuration: number;
  execDuration: number;
  completed: number;
  failed: number;
  newProposals: number;
  applied: number;
  blocked: number;
  buildOk: boolean;
  testOk: boolean;
  convergence: boolean; // 本轮无新提案 → 收敛
}

async function runIteration(
  infra: Infra,
  round: number,
  prevResult: RoundResult | null,
): Promise<RoundResult> {
  const { workspace, metaAgent, board, pool, observer, scheduler, memory, knownProposalIds } = infra;

  header(`第 ${round} 轮 — ${"🏛️⚙️🔁🧬📜".charAt((round - 1) % 5)} 五环联动自演进`);

  const conVersion = readConstitutionVersion(workspace);
  info("当前宪法版本", conVersion);
  info("已知提案", `${knownProposalIds.size} 条`);

  // ── 构造意图（逐轮演进）──
  const prevSummary = prevResult
    ? `\n上一轮结果：${prevResult.newProposals} 条新提案，${prevResult.applied} 条已应用，${prevResult.blocked} 条阻塞。宪法版本已升至 ${conVersion}。`
    : `\n宪法当前版本 ${conVersion}（v2.5.14，刚完成原则七子约束闭环修复）。`;

  const intent = [
    "你是 Cortex 的 MetaAgent（甘雨），负责战术调度。",
    "",
    `本次意图——五环联动自演进第 ${round} 轮。`,
    prevSummary,
    "",
    "**任务**：全面审查 Cortex 系统——不止宪法，还有代码质量、架构一致性、技能体系。",
    "",
    "**审查维度**：",
    "1. 宪法治理——宪法是否还有未闭合的缺口？条款间是否有矛盾？",
    "2. 代码质量——packages/ 代码是否存在可修复的缺陷？需要 FixAgent 诊断修复。",
    "3. 架构一致性——文档描述与代码实现是否一致？Agent 边界是否清晰？",
    "4. 技能沉淀——LoopAgent 应扫描近期的执行模式，提炼可复用的技能。",
    "",
    "**可用全 Agent 池（10+ 个）**：",
    "- DocGovernAgent（凝光）：宪法审计 → 发现缺口 → 生成修宪提案 JSON",
    "  ⚠️ 凝光生成提案的 before 字段时，必须先用 read_constitution_exact 工具精确读取宪法原文片段，",
    "  然后逐字复制到 before 字段中。禁止凭记忆改写、概括、添加省略号。before 必须与宪法原文完全一致。",
    "- ReviewAgent（刻晴）：代码审查 → 发现缺陷 → 输出诊断报告",
    "- FixAgent（希格雯）：读取诊断报告 → 最小修复 → 验证修复",
    "- AnalysisAgent（纳西妲）：架构分析 → 评估影响范围",
    "- InspectorAgent（安柏）：事实采集 → 宪法结构/代码统计",
    "- CodeAgent（阿贝多）：代码实现/重构",
    "- LoopAgent（莫娜）：模式发现 → 技能提炼",
    "- OpsAgent（北斗）：运维诊断 → build/test 检查",
    "- ApiAgent（久岐忍）：API 设计审查",
    "- DataAgent（艾尔海森）：数据模型审查",
    "",
    "**规划要求**：",
    "- 至少规划 1 个 doc_govern 节点给凝光（宪法审计 + 提案生成）",
    "- 至少规划 1 个 review + fix 配对（刻晴审查 → 希格雯修复，执行+自我演进闭环）",
    `- 可以规划 loop 节点给莫娜做技能沉淀（认知闭环）`,
    "- 可以规划 analysis 节点给纳西妲做影响评估",
    "- 节点数控制在 5-7 个，不要膨胀",
    "",
    round > 1
      ? `**特别注意**：这是第 ${round} 轮——宪法已在上轮更新。请基于最新宪法（${conVersion}）重新审计，避免重复发现已修复的问题。`
      : "**注意**：这是首轮审计——宪法刚从 v2.5.13 升至 v2.5.14（原则七子约束闭环修复）。请先完整审计现有宪法，再决定是否需要新的修宪。",
  ].join("\n");

  console.log(`\n  意图摘要:\n${intent.split("\n").slice(0, 8).map(l => `    ${l}`).join("\n")}...\n`);

  // ── MetaAgent 规划 ──
  const planStart = Date.now();
  const plan = await metaAgent.plan(intent);
  const planDuration = Date.now() - planStart;

  if (plan.length === 0) {
    console.error("❌ MetaAgent 产出 0 个任务节点");
    return { round, planDuration, execDuration: 0, completed: 0, failed: 0, newProposals: 0, applied: 0, blocked: 0, buildOk: false, testOk: false, convergence: false };
  }

  console.log(`\n  甘雨计划 (${plan.length} 个节点, ${(planDuration / 1000).toFixed(1)}s):`);
  for (const n of plan) {
    console.log(`    📋 [${n.type}] ${n.id.slice(0, 25)}... — tags: ${(n.tags ?? []).join(", ")}`);
  }
  for (const n of plan) board.addNode(n);

  // ── 事件监听 ──
  observer.on(PipelinePriority.HIGH, (e: any) => {
    const p = e.payload as any;
    const id = p?.nodeId ? `[${(p.nodeId as string).slice(0, 18)}]` : "";
    if (e.type === "node.complete") {
      console.log(`   ✅ ${id} ${p.agentType ?? "?"} 完成`);
    } else if (e.type === "node.failed") {
      console.log(`   ❌ ${id} 失败: ${String(p.error ?? "").slice(0, 100)}`);
    } else if (e.type === "node.replan") {
      console.log(`   🔄 ${id} 重规划 #${p.attempt}`);
    }
  });

  // ── Scheduler 执行 ──
  const execStart = Date.now();
  const report = await scheduler.executeAll();
  const execDuration = Date.now() - execStart;

  console.log(`\n  完成: ${report.completed}  失败: ${report.failed}  耗时: ${(execDuration / 1000).toFixed(1)}s\n`);

  // 打印每个节点的简要输出
  const allNodes = board.getAllNodes();
  for (const n of allNodes) {
    const icon = n.status === "done" ? "✅" : n.status === "failed" ? "❌" : "⏳";
    const outputPreview = n.results.map(r => (r.output ?? r.error ?? "?").slice(0, 500)).join(" | ");
    console.log(`   ${icon} [${n.type}] ${outputPreview}`);
  }

  // ── 昔涟评判新提案 ──
  const newProposals = collectNewProposals(knownProposalIds, workspace);
  console.log(`\n  📋 新生成提案: ${newProposals.length} 条`);

  const constitutionPath = path.resolve(workspace, "docs", "constitution", "Cortex 概念顶层设计 v2.5.md");
  const constitution = fs.readFileSync(constitutionPath, "utf-8");
  const constitutionDir = path.resolve(workspace, "docs", "constitution");

  let applied = 0;
  let blocked = 0;

  for (const proposal of newProposals) {
    knownProposalIds.add(proposal.id);
    console.log(`\n  ── ${proposal.id} ──`);
    info("章节", proposal.section);
    info("目标版本", proposal.version);
    info("摘要", proposal.summary);

    const judgment = evaluateAmendment(proposal, constitution);

    let allChecksPassed = true;
    for (const check of judgment.checks) {
      if (check.passed) {
        passed(check.name);
      } else {
        failed(check.name, check.detail);
        allChecksPassed = false;
      }
    }

    const verdictLabel: Record<string, string> = {
      APPROVED: "✅ 通过",
      APPROVED_WITH_CAVEATS: "⚠️ 附条件通过",
      BLOCKED: "🚫 阻塞",
      NEEDS_CLARIFICATION: "❓ 需要澄清",
    };
    console.log(`  📌 裁决: ${verdictLabel[judgment.verdict] ?? judgment.verdict}`);

    if (judgment.blocking.length > 0) {
      for (const b of judgment.blocking) console.log(`     🚫 ${b}`);
      blocked++;
    }

    // 自动应用 APPROVED/APPROVED_WITH_CAVEATS 提案
    if (judgment.verdict === "APPROVED" || judgment.verdict === "APPROVED_WITH_CAVEATS") {
      console.log("  ⚡ 自主修宪闭环——自动写入宪法...");
      const applyResult = applyAmendment(proposal, constitutionDir);
      if (applyResult.success) {
        passed(`修宪写入成功 → ${applyResult.appliedVersion}`);
        applied++;
        // 更新提案状态
        proposal.status = "applied";
        const propPath = path.join(workspace, "docs", "amendments", `${proposal.id}.json`);
        if (fs.existsSync(propPath)) {
          const updated = { ...JSON.parse(fs.readFileSync(propPath, "utf-8")), status: "applied" };
          fs.writeFileSync(propPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
        }
      } else {
        failed(`修宪写入失败`, applyResult.error);
      }
    }
  }

  // ── build + test 验证 ──
  let buildOk = false;
  let testOk = false;

  try {
    execSync("pnpm build", { cwd: workspace, timeout: 120_000, stdio: "pipe", encoding: "utf-8" });
    passed("pnpm build 通过");
    buildOk = true;
  } catch (e: any) {
    failed("pnpm build", e.stderr?.slice(-300) ?? String(e));
  }

  try {
    execSync("pnpm test", { cwd: workspace, timeout: 300_000, stdio: "pipe", encoding: "utf-8" });
    passed("pnpm test 全部通过");
    testOk = true;
  } catch (e: any) {
    failed("pnpm test", e.stderr?.slice(-300) ?? String(e));
  }

  // ── 认知闭环：记录本轮总结 ──
  const memCount = memory.read({}).length;
  info("跨轮记忆累积", `${memCount} 条`);

  // ── 收敛判定 ──
  const convergence = newProposals.length === 0;
  if (convergence) {
    console.log("\n  🎯 本轮无新提案——宪法可能已收敛。");
  }

  return {
    round, planDuration, execDuration,
    completed: report.completed, failed: report.failed,
    newProposals: newProposals.length, applied, blocked,
    buildOk, testOk, convergence,
  };
}

// ══════════════════════════════════════════════
// 5. 主流程
// ══════════════════════════════════════════════

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🔄 五环联动 全闭合自演进 E2E                    ║");
  console.log("║   执行·认知·治理·自我演进·自主修宪               ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const infra = await setupOnce();
  info("Chat", infra.chatModel);
  info("项目", infra.workspace);
  info("MemoryStore", "跨轮复用（认知闭环）");

  // 注册全 Agent 日志
  console.log(`\n  🎭 全 Agent 池就绪：`);
  const agentLabels = [
    "阿贝多(code)", "刻晴(review)", "纳西妲(analysis)", "北斗(ops)", "莫娜(loop)",
    "凝光(doc-govern)", "久岐忍(api)", "艾尔海森(data)", "希格雯(fix)", "安柏(inspector)",
    "管家(butler)",
  ];
  console.log(`     ${agentLabels.join(" | ")}`);

  const results: RoundResult[] = [];
  let prevResult: RoundResult | null = null;

  for (let round = 1; round <= MAX_ITERATIONS; round++) {
    const result = await runIteration(infra, round, prevResult);
    results.push(result);

    if (result.convergence) {
      console.log(`\n  🎯 第 ${round} 轮收敛——宪法完备，闭环结束。`);
      break;
    }

    if (round < MAX_ITERATIONS && !result.convergence) {
      console.log(`\n  ⏳ 第 ${round} 轮结束，进入第 ${round + 1} 轮...`);
    }
  }

  // ── 最终总结 ──
  header("五环联动自演进 终局总结");

  console.log("\n  ┌──────┬────────┬────────┬────────┬────────┬────────┬────────┐");
  console.log("  │ 轮次 │ 规划(s)│ 执行(s)│ 新提案 │ 已应用 │ 阻塞  │ 收敛  │");
  console.log("  ├──────┼────────┼────────┼────────┼────────┼────────┼────────┤");
  for (const r of results) {
    const conv = r.convergence ? "✅" : "—";
    console.log(`  │  ${r.round}   │ ${(r.planDuration / 1000).toFixed(0).padStart(4)}   │ ${(r.execDuration / 1000).toFixed(0).padStart(4)}   │   ${r.newProposals}    │   ${r.applied}    │   ${r.blocked}   │  ${conv}   │`);
  }
  console.log("  └──────┴────────┴────────┴────────┴────────┴────────┴────────┘");

  const conVersion = readConstitutionVersion(infra.workspace);
  console.log(`\n  📜 宪法终态版本: ${conVersion}`);
  const memCount = infra.memory.read({}).length;
  console.log(`  🧠 跨轮记忆累积: ${memCount} 条`);
  console.log(`  🔄 总轮次: ${results.length}/${MAX_ITERATIONS}`);

  // 治理摘要
  try {
    const summary = summarizeGovernance(infra.workspace);
    console.log(`\n  📊 治理摘要:`);
    console.log(`     待评判: ${summary.pendingJudgment}  已批准: ${summary.approved}  已阻塞: ${summary.blocked}  已应用: ${summary.applied}`);
  } catch { /* skip */ }

  const allConverged = results.some(r => r.convergence);
  const allBuildOk = results.every(r => r.buildOk);
  const allTestOk = results.every(r => r.testOk);

  if (allConverged) {
    console.log("\n  🎯🎯🎯 五环联动自演进收敛——宪法完备，闭环完成 🎯🎯🎯\n");
  } else if (allBuildOk && allTestOk) {
    console.log("\n  ✅ 五环联动自演进完成——build+test 全量通过\n");
  } else {
    console.log("\n  ⚠️  五环联动部分完成——存在阻塞项\n");
  }

  await infra.memory.close();

  if (!allBuildOk || !allTestOk) process.exit(1);
}

main().catch((e) => {
  console.error("💥 五环联动 E2E 崩溃:", e);
  process.exit(1);
});
