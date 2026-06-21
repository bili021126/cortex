/**
 * Cortex 自审视实验——甘雨召集审视委员会，对共识修复清单逐项验证
 *
 * 用法: npx tsx tests/manual/scripts/cortex-self-examination.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 场景:
 *   甘雨（MetaAgent）收到一份共识修复清单。她没有自己逐项查验——
 *   那会压垮她一个人。她做了一个秘书该做的事：把任务拆开，分给七位专家，
 *   每人只负责自己最擅长的那一块。任务结束，甘雨只做汇总，不替专家下判断。
 *
 * 硬约束（安全边界，不可突破）:
 *   - 所有 Agent 只能使用 read_file / search_code / list_files 读取项目文件
 *   - write_file 仅允许写入 test-output/self-examination/ 输出目录（审视报告）
 *   - run_shell、delete_file 被显式禁止
 *   - 不能触碰 packages/ 和 docs/ 下的任何文件
 *
 * 软约束（开放性引导）:
 *   - 不规定具体产出格式
 *   - 不规定审查范围
 *   - 由甘雨自主决定如何组织团队
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { AgentType, LinkType, PipelinePriority, PipelineEventType, type TaskNode, type MemoryKind, type SafeErrorReporter } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import {
  TaskBoard,
  AgentPool,
  PipelineObserver,
  ConfirmGate} from "@cortex/scheduler";
import {
  createAgent,
  codeAgentConfig,
  reviewAgentConfig,
  createInspectorAgent,
  createBrowserAgent,
  analysisAgentConfig,
  docGovernAgentConfig,
  loopAgentConfig,
  opsAgentConfig,
  apiAgentConfig,
  dataAgentConfig,
  Scheduler,
  ButlerAgent,
  MetaAgent,
  StrategistAgent} from "@cortex/engine";
import { Toolkit, compressForRoundtable } from "@cortex/platform";
import { MemoryStore } from "@cortex/memory-store";
import { runMeeting, CODE_REVIEW_ROUNDTABLE, SOFT_CONSENSUS_ROUNDTABLE } from "../config/roundtable-config";
import { runCrossVerification, loadCrossVerifyPairs, type VerifierAgent } from "./cross-verification";
import { registerExaminationTools } from "./examination-toolkit";
import { runStrategyAnalysis } from "./strategy-analysis";
import { resolveLlmConfig } from "../config/llm-defaults";
import cortexConfig from "../../../../../cortex-agents.json" assert { type: "json" };

// ═══════════════════════════════════════════════
// 1. 环境变量——从根目录 .env 加载
// ═══════════════════════════════════════════════

function loadEnv() {
  const envPath = path.resolve(process.cwd(), "..", "..", ".env");
  if (!fs.existsSync(envPath)) {
    const alt = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(alt)) {
      console.error("错误：.env 文件不存在，请在项目根目录创建 .env 并配置 DEEPSEEK_API_KEY");
      process.exit(1);
    }
    const lines = fs.readFileSync(alt, "utf-8").split("\n");
    for (const line of lines) {
      const clean = line.replace(/\r$/, "");
      const m = clean.match(/^([^=]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].trim();
    }
    return;
  }
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const clean = line.replace(/\r$/, "");
    const m = clean.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

// ═══════════════════════════════════════════════
// 2. 种子记忆——帮委员会快速了解项目
// ═══════════════════════════════════════════════

async function seedExaminationMemory(memory: MemoryStore): Promise<void> {
  const existing = await memory.read({
    metadataFilter: { taskId: cortexConfig.seedMemories.entries[0].taskId },
    limit: 1});
  if (existing.length > 0) return;

  let prevId: string | undefined;
  for (const entry of cortexConfig.seedMemories.entries) {
    const memId = await memory.write({
      source: { agentType: AgentType[entry.agentType as keyof typeof AgentType] as any, taskId: entry.taskId },
      kind: (entry.memoryType === "Conceptual" ? "Insight" : "TaskLog") as MemoryKind,
      content_blob: entry.content as any,
      semantic_gist: entry.summary,
      content_hash: entry.taskId,
      summary: entry.summary });
    if (prevId && (entry as any).linkTo) {
      memory.link(memId, prevId, LinkType.DerivedFrom);
    }
    prevId = memId;
  }
}

/**
 * 为质量严控 Agent 加载上轮审视报告作为上下文种子记忆。
 * 仅加载已验证思维框架稳定的 Agent 的上轮产出——
 * 刻晴（questioning-authority）、纳西妲（trace-to-source）、凝光（rule-supremacy）。
 * 这是方案F「审计结论注入下一轮自审视」在脚本层的最小落地。
 */
async function seedPreviousReports(
  memory: MemoryStore,
  outputDir: string,
  reportMaxChars: number,
): Promise<void> {
  const QUALITY_AGENTS: Record<string, { agentType: AgentType; label: string }> = {
    keqing: { agentType: AgentType.Review, label: "刻晴" },
    nahida: { agentType: AgentType.Analysis, label: "纳西妲" },
    ningguang: { agentType: AgentType.DocGovern, label: "凝光" }};

  if (!fs.existsSync(outputDir)) return;

  const existing = await memory.read({
    metadataFilter: { taskId: "self-exam-constitution-index" },
    limit: 1});
  const indexMemId = existing.length > 0 ? existing[0].id : undefined;

  for (const [key, { agentType, label }] of Object.entries(QUALITY_AGENTS)) {
    // 跳过已注入的报告（幂等）
    const prevInjected = await memory.read({
      metadataFilter: { taskId: `self-exam-prev-report-${key}` },
      limit: 1});
    if (prevInjected.length > 0) continue;

    const files = fs.readdirSync(outputDir);
    const reportFile = files.find(
      (f) => f.startsWith(key) && f.endsWith(".md") && f !== "self-examination-summary.md",
    );
    if (!reportFile) continue;

    const reportPath = path.join(outputDir, reportFile);
    let content: string;
    try {
      content = fs.readFileSync(reportPath, "utf-8");
    } catch {
      continue;
    }

    // 截断过长内容——完整报告留在文件系统，记忆里放精要
    const truncated = content.length > reportMaxChars
      ? content.slice(0, reportMaxChars) + `\n\n...(截断，全文 ${content.length} 字符见上轮报告 ${reportFile})`
      : content;

    try {
      const reportId = await memory.write({
        source: { agentType, taskId: `self-exam-prev-report-${key}` },
        kind: "Insight",
        content_blob: {
          taskType: "previous-examination-report",
          entities: [key, "self-examination", "previous-round"],
          decision: truncated,
          outcome: "context"},
        semantic_gist: `${label}（${key}）上轮审视报告：${reportFile}`,
        content_hash: `self-exam-prev-report-${key}`,
        summary: `${label}（${key}）上轮审视报告：${reportFile}（${content.length} 字符）` });

      if (indexMemId) {
        memory.link(reportId, indexMemId, LinkType.DerivedFrom);
      }
    } catch {
      // 写入失败不阻塞整体流程
    }
  }
}

// ═══════════════════════════════════════════════
// 4. 聚合摘要生成——自审视闭环输出
// ═══════════════════════════════════════════════

interface ReportMeta {
  file: string;
  size: number;
  mtime: Date;
  title: string;
  passCount: number;
  failCount: number;
  warningCount: number;
}

function extractReportMeta(filePath: string): ReportMeta | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    // 提取标题（第一个 # 或 ## 行）
    let title = "";
    for (const line of lines) {
      const m = line.match(/^#{1,2}\s+(.+)/);
      if (m) { title = m[1].trim(); break; }
    }

    // 统计标记
    let passCount = 0, failCount = 0, warningCount = 0;
    for (const line of lines) {
      if (/✅|\[x\]|通过|已闭合|已修复|已完成/.test(line)) passCount++;
      if (/❌|\s未完成|未修复|未开始/.test(line)) failCount++;
      if (/⚠|⚠️|黄灯|部分|残留/.test(line)) warningCount++;
    }

    return {
      file: path.basename(filePath),
      size: Buffer.byteLength(content),
      mtime: fs.statSync(filePath).mtime,
      title,
      passCount,
      failCount,
      warningCount};
  } catch {
    return null;
  }
}

function generateExaminationSummary(
  outputDir: string,
  report: { completed: number; failed: number },
  execDuration: number,
  fixListPath: string,
  isSoft: boolean = false,
): string {
  const now = new Date().toISOString().slice(0, 10);

  // 扫描产出文件
  const metas: ReportMeta[] = [];
  if (fs.existsSync(outputDir)) {
    const files = fs.readdirSync(outputDir);
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      if (f === "self-examination-summary.md") continue;
      const meta = extractReportMeta(path.join(outputDir, f));
      if (meta) metas.push(meta);
    }
  }

  const fixListLabel = path.basename(fixListPath);

  const lines: string[] = [];

  lines.push(isSoft ? "# 自由审视摘要" : "# 自审视验证摘要");
  lines.push("");
  lines.push(isSoft ? "> 产出方式：7 位 Agent 并行探索（MetaAgent 自规划）" : "> 产出方式：7 位 Agent 并行验证（MetaAgent 自规划）");
  lines.push(isSoft ? `> 探索日期：${now}` : `> 验证日期：${now}`);
  lines.push(`> 输入清单：${fixListLabel}`);
  lines.push(`> 执行耗时：${(execDuration / 1000).toFixed(0)}s`);
  lines.push(`> 完成: ${report.completed}  失败: ${report.failed}`);
  lines.push(`> 此文件由 cortex-self-examination.ts 自动生成，每次运行覆写。旧版追加至「历史版本」区。`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // 执行概况
  lines.push("## 执行概况");
  lines.push("");
  lines.push(`- 调度完成: ${report.completed} 个任务`);
  lines.push(`- 调度失败: ${report.failed} 个任务`);
  lines.push(`- 全流程耗时: ${(execDuration / 1000).toFixed(1)}s (${(execDuration / 60000).toFixed(1)}min)`);
  lines.push(`- 产出报告: ${metas.length} 个`);
  lines.push("");

  // Agent 产出明细
  lines.push("## Agent 产出明细");
  lines.push("");
  lines.push("| Agent | 报告文件 | 大小 | 标题 | ✅ | ❌ | ⚠️ |");
  lines.push("|-------|----------|------|------|----|----|-----|");

  // key→显示名 映射（从 agent-registry.json 派生）
  const agentKeys = cortexConfig.selfExamination.agents.hard;
  const agentDisplay: Record<string, { emoji: string; label: string }> = {};
  for (const key of agentKeys) {
    const agent = (cortexConfig.agents as Record<string, { display?: { emoji: string; shortName: string } }>)[key];
    if (agent?.display) agentDisplay[key] = { emoji: agent.display.emoji, label: agent.display.shortName };
  }

  for (const key of agentKeys) {
    const meta = metas.find((m) => m.file.includes(key));
    if (meta) {
      const kb = (meta.size / 1024).toFixed(1);
      const titleShort = meta.title.slice(0, 40) + (meta.title.length > 40 ? "…" : "");
      const disp = agentDisplay[key] ?? { emoji: "", label: key };
      lines.push(`| ${disp.emoji}${disp.label} | ${meta.file} | ${kb}KB | ${titleShort} | ${meta.passCount} | ${meta.failCount} | ${meta.warningCount} |`);
    }
  }
  lines.push("");
  lines.push(`> 统计口径：✅=通过/闭合标记  ❌=未完成标记  ⚠️=黄灯/残留标记。仅供参考，以各报告全文为准。`);
  lines.push("");

  // 整体状态
  const totalPass = metas.reduce((s, m) => s + m.passCount, 0);
  const totalFail = metas.reduce((s, m) => s + m.failCount, 0);
  const totalWarn = metas.reduce((s, m) => s + m.warningCount, 0);

  lines.push("## 整体状态速览");
  lines.push("");
  lines.push(`- ✅ 通过/闭合: ${totalPass}`);
  lines.push(`- ❌ 未完成: ${totalFail}`);
  lines.push(`- ⚠️ 黄灯/残留: ${totalWarn}`);
  lines.push("");

  if (report.failed > 0) {
    lines.push(`### ⚠️ 失败任务`);
    lines.push("");
    lines.push(`有 ${report.failed} 个 Agent 验证任务失败，请检查上方日志。对应报告可能未生成或不完整。`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(isSoft ? `*自由审视摘要，由 cortex-self-examination.ts 自动生成，${now}*` : `*自审视验证摘要，由 cortex-self-examination.ts 自动生成，${now}*`);
  lines.push("");

  return lines.join("\n");
}

function writeExaminationSummary(
  outputDir: string,
  report: { completed: number; failed: number },
  execDuration: number,
  fixListPath: string,
  summaryPath: string,
  isSoft: boolean = false,
): void {
  const newContent = generateExaminationSummary(outputDir, report, execDuration, fixListPath, isSoft);

  // 读取旧内容，追加到历史版本区
  let oldContent = "";
  if (fs.existsSync(summaryPath)) {
    oldContent = fs.readFileSync(summaryPath, "utf-8");
  }

  const historyBlock = oldContent
    ? [
        "",
        "---",
        "",
        "## 📜 历史版本（自动追加，方便追溯）",
        "",
        "> 以下为本次验证前的内容。每次自审视完成后，旧版自动移入此区。",
        "",
        oldContent,
      ].join("\n")
    : "";

  const finalContent = newContent + historyBlock;
  fs.writeFileSync(summaryPath, finalContent, "utf-8");
  console.log(`   📝 ${isSoft ? "自由审视" : "自审视"}摘要已覆写: ${summaryPath} (${Buffer.byteLength(finalContent)} bytes)`);
  if (oldContent) {
    console.log(`   📜 旧版已追加至「历史版本」区`);
  }
}

// ═══════════════════════════════════════════════
// 5. 主流程——甘雨召集审视委员会
// ═══════════════════════════════════════════════

function agentName(type: string): string {
  // 从 cortex-agents.json 按 agentType 查 displayName
  for (const [key, agent] of Object.entries(cortexConfig.agents)) {
    if (agent.type === type) return `${agent.display?.shortName ?? key} (${key.charAt(0).toUpperCase() + key.slice(1)})`;
  }
  return type;
}

async function main() {
  // ── 模式检测 ──
  const args = process.argv.slice(2);
  const SOFT_MODE = args.includes("--soft") || args.includes("--mode") && args.includes("soft");

  // Windows 终端 UTF-8 显示修复：chcp 操作控制台句柄，跨进程生效
  if (process.platform === "win32") {
    try { execSync("chcp 65001", { stdio: "pipe" }); } catch { /* 静默 */ }
  }

  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) {
    console.error("错误：DEEPSEEK_API_KEY 未设置，请在 .env 中配置");
    process.exit(1);
  }

  const llmCfg = resolveLlmConfig({ chatModel: "deepseek-v4-flash" });
  const BASE_URL = llmCfg.baseUrl;
  const CHAT_MODEL = llmCfg.chatModel;
  const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? llmCfg.chatModel;
  const REASONING_EFFORT = llmCfg.reasoningEffort;
  const REPORT_MAX_CHARS = parseInt(process.env.SE_REPORT_MAX_CHARS ?? String(cortexConfig.selfExamination.reportMaxCharsDefault), 10);

  // 使用 import.meta.url 推导路径，避免 cd 到不同目录导致路径解析错误
  const __filename = fileURLToPath(import.meta.url);
  const SCRIPTS_DIR = path.dirname(__filename);
  const ENGINE_DIR = path.resolve(SCRIPTS_DIR, "..", "..", "..");
  const ROOT = path.resolve(ENGINE_DIR, "..", "..");
  const OUTPUT_DIR = path.join(ROOT, SOFT_MODE ? cortexConfig.selfExamination.outputDir.soft : cortexConfig.selfExamination.outputDir.hard);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const MODE_LABEL = SOFT_MODE ? "🔍 自由审视" : "🔬 修复验证审视";
  const MODE_DESC = SOFT_MODE
    ? "软约束 · 不设目标 · 开放所有文件"
    : "输入: consensus-fix-list.md · 只读 · 联合汇报";

  console.log("╔══════════════════════════════════════════════════╗");
  console.log(`║  ${MODE_LABEL}                            ║`);
  console.log(`║  ${MODE_DESC}      ║`);
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  项目: ${ROOT}`);
  console.log(`  输出目录: ${OUTPUT_DIR}`);
  console.log(`  模型: ${CHAT_MODEL}`);
  console.log(`  端点: ${BASE_URL}\n`);

  // ── 初始化组件 ──
  console.log("🟢 [第一阶段] 初始化组件...");

  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    reasonerModel: REASONER_MODEL,
    reasoningEffort: REASONING_EFFORT as "high" | "max"});
  adapter.setCacheEnabled(true);

  const metaAgent = new MetaAgent(adapter);
  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();

  // ── onInvariant 注入：将 invariant 违规从 console.error 接驳入 observer 可观测管道 ──
  // 审判决议（刻晴 #7 + 莫娜 §2.2）：静态回调虽已定义，但 bootstrap 未设值，
  // 导致 TaskBoard/AgentPool 状态不一致时仅走 console.error，不进 observer，用户不可见。
  TaskBoard.onInvariant = (ctx) => {
    observer.emit({
      type: PipelineEventType.SchedulerInvariantViolation,
      priority: PipelinePriority.CRITICAL,
      payload: ctx,
      timestamp: Date.now()});
  };
  AgentPool.onInvariant = (ctx) => {
    observer.emit({
      type: PipelineEventType.AgentPoolInvariantViolation,
      priority: PipelinePriority.CRITICAL,
      payload: ctx,
      timestamp: Date.now()});
  };
  const gate = new ConfirmGate();
  gate.bypassAll();

  // 全新记忆数据库
  const memory = new MemoryStore();
  const MEMORY_DB = path.join(ROOT, ".cortex", "memory-self-exam.db");
  await memory.init(MEMORY_DB);
  await seedExaminationMemory(memory);
  await seedPreviousReports(memory, OUTPUT_DIR, REPORT_MAX_CHARS);
  console.log(`   🧠 MemoryStore: ${MEMORY_DB}`);
  console.log(`   📖 种子记忆: 项目入口指引 + 设计哲学 + 上轮审视报告（刻晴/纳西妲/凝光）\n`);

  // ── Agent 池注册 ──
  pool.register({ type: AgentType.Code, maxInstances: 12 });
  pool.register({ type: AgentType.Review, maxInstances: 12 });
  pool.register({ type: AgentType.Inspector, maxInstances: 12 });
  pool.register({ type: AgentType.Browser, maxInstances: 12 });
  pool.register({ type: AgentType.Analysis, maxInstances: 12 });
  pool.register({ type: AgentType.DocGovern, maxInstances: 12 });
  pool.register({ type: AgentType.Ops, maxInstances: 12 });
  pool.register({ type: AgentType.Loop, maxInstances: 12 });
  pool.register({ type: AgentType.Butler, maxInstances: 12 });
  pool.register({ type: AgentType.Api, maxInstances: 12 });
  pool.register({ type: AgentType.Data, maxInstances: 12 });
  pool.register({ type: AgentType.Strategist, maxInstances: 12 });

  const scheduler = new Scheduler(board, pool, observer, metaAgent);

  // ── 注册审视委员 ──
  console.log("🟢 [第二阶段] 召集审视委员会...");

  // 阿贝多——西风骑士团首席炼金术士，用科学与实验精神审视代码
  const codeToolkit = new Toolkit(gate);
  registerExaminationTools(codeToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const codeAgent = createAgent(codeAgentConfig("code"), adapter, codeToolkit, memory);
  await codeAgent.wakeup();
  scheduler.register(AgentType.Code, codeAgent, CHAT_MODEL);
  console.log("   ⚗️ 阿贝多 (Code) —— 炼金术士，" + (SOFT_MODE ? "核心层深度审查" : "P0 深度代码审查"));

  // 刻晴——璃月七星之玉衡，效率至上的法典审查者
  const reviewToolkit = new Toolkit(gate);
  registerExaminationTools(reviewToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const reviewAgent = createAgent(reviewAgentConfig("review"), adapter, reviewToolkit, memory);
  await reviewAgent.wakeup();
  scheduler.register(AgentType.Review, reviewAgent, CHAT_MODEL);
  console.log("   ⚡ 刻晴 (Review) —— 玉衡星，" + (SOFT_MODE ? "代码质量侦察" : "P1 修复验证"));

  // 安柏——西风骑士团侦察骑士，永远元气满满的现场调查员
  const inspectorToolkit = new Toolkit(gate);
  registerExaminationTools(inspectorToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const inspectorAgent = createInspectorAgent(adapter, inspectorToolkit);
  inspectorAgent.setWorkspaceRoot(ROOT);
  await inspectorAgent.wakeup();
  scheduler.register(AgentType.Inspector, inspectorAgent, CHAT_MODEL);
  console.log("   🐰 安柏 (Inspector) —— 侦察骑士，" + (SOFT_MODE ? "全项目侦察" : "变更规模统计"));

  // 宵宫——长野原烟花店，观察者视角
  const browserToolkit = new Toolkit(gate);
  registerExaminationTools(browserToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const browserAgent = createBrowserAgent(adapter, browserToolkit);
  browserAgent.setWorkspaceRoot(ROOT);
  await browserAgent.wakeup();
  scheduler.register(AgentType.Browser, browserAgent, CHAT_MODEL);
  console.log("   🎆 宵宫 (Browser) —— 审查观察者");

  // 纳西妲——草神，温柔但有深度的架构分析师
  const analysisToolkit = new Toolkit(gate);
  registerExaminationTools(analysisToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const analysisAgent = createAgent(analysisAgentConfig("analysis"), adapter, analysisToolkit, memory);
  await analysisAgent.wakeup();
  scheduler.register(AgentType.Analysis, analysisAgent, CHAT_MODEL);
  console.log("   🌿 纳西妲 (Analysis) —— 草神，" + (SOFT_MODE ? "架构全景分析" : "P3 验证与架构趋势"));

  // 凝光——璃月七星之天权，群玉阁的主人，律法与治理的巨擘
  const docGovernToolkit = new Toolkit(gate);
  registerExaminationTools(docGovernToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const docGovernAgent = createAgent(docGovernAgentConfig("doc-govern"), adapter, docGovernToolkit);
  await docGovernAgent.wakeup();
  scheduler.register(AgentType.DocGovern, docGovernAgent, CHAT_MODEL);
  console.log("   💎 凝光 (DocGovern) —— 天权星，" + (SOFT_MODE ? "治理合规审计" : "清单一致性审计"));

  // 莫娜——占星术士，能从水镜中看见隐藏的模式与趋势
  const loopToolkit = new Toolkit(gate);
  registerExaminationTools(loopToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const loopAgent = createAgent(loopAgentConfig("loop"), adapter, loopToolkit);
  await loopAgent.wakeup();
  scheduler.register(AgentType.Loop, loopAgent, CHAT_MODEL);
  console.log("   🔮 莫娜 (Loop) —— 占星术士，" + (SOFT_MODE ? "模式发现与趋势预言" : "修复质量趋势"));

  // 北斗——南十字船队大姐头，见过大风大浪的工程实干家
  const opsToolkit = new Toolkit(gate);
  registerExaminationTools(opsToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const opsAgent = createAgent(opsAgentConfig("ops"), adapter, opsToolkit);
  await opsAgent.wakeup();
  scheduler.register(AgentType.Ops, opsAgent, CHAT_MODEL);
  console.log("   ⚓ 北斗 (Ops) —— 南十字船长，" + (SOFT_MODE ? "工程就绪诊断" : "P2 验证与工程诊断"));

  // 久岐忍——荒泷派外务奉行，API 契约押运
  const apiToolkit = new Toolkit(gate);
  registerExaminationTools(apiToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const apiAgent = createAgent(apiAgentConfig("api"), adapter, apiToolkit, memory);
  await apiAgent.wakeup();
  scheduler.register(AgentType.Api, apiAgent, CHAT_MODEL);
  console.log("   😈 久岐忍 (Api) —— 外务奉行，" + (SOFT_MODE ? "API 契约探索" : "API 契约验证"));

  // 艾尔海森——教令院大书记官，数据完整性审计
  const dataToolkit = new Toolkit(gate);
  registerExaminationTools(dataToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const dataAgent = createAgent(dataAgentConfig("data"), adapter, dataToolkit, memory);
  await dataAgent.wakeup();
  scheduler.register(AgentType.Data, dataAgent, CHAT_MODEL);
  console.log("   📚 艾尔海森 (Data) —— 大书记官，" + (SOFT_MODE ? "数据模型探索" : "数据完整性审计"));

  // 钟离——往生堂客卿，岩王帝君，契约守护者。不注册到 Scheduler——不参与任务派发，
  // 在第四阶段所有 Agent 完成探索后独立激活，读取全部报告做战略分析。
  const strategistAgent = new StrategistAgent(adapter);
  await strategistAgent.wakeup();
  pool.spawn(AgentType.Strategist, "zhongli");
  strategistAgent.setPool(pool, "zhongli");
  console.log("   🗿 钟离 (Strategist) —— 岩王帝君，" + (SOFT_MODE ? "契约守护+战略分析" : "阶段跃迁判定"));

  // 霜凝——超越者，方向监理。不注册到 Scheduler——不参与任务派发，
  // 在第四阶段半钟离分析后独立激活，读取全部报告做方向判断与矛盾暴露。
  const shuangningAgent = new StrategistAgent(adapter);
  await shuangningAgent.wakeup();
  pool.spawn(AgentType.Strategist, "shuangning");
  shuangningAgent.setPool(pool, "shuangning");
  console.log("   ❄️ 霜凝 (Strategist) —— 超越者，" + (SOFT_MODE ? "方向监理+矛盾暴露" : "监理"));

  // 托马——神里家管，旁观者，不参与任务派遣
  const butlerAgent = new ButlerAgent(observer);
  await butlerAgent.wakeup();
  scheduler.register(AgentType.Butler, butlerAgent, CHAT_MODEL);
  console.log("   🍵 托马 (Butler) —— 神里家管，旁观记录\n");

  // ── SafeReporter 注入：将所有 Agent 的 _safeReporter 接驳入 observer 管道 ──
  // 审判决议（刻晴 C1 + 莫娜 §1.2）：_safeReporter 默认为 null，
  // 静默 catch 中 _safeReporter?.() 的可选链在 null 上等于空操作，5 处安保失效。
  // 每 Agent 实例注入 observer-backed reporter，杜绝静默吞错。
  const safeReporter: SafeErrorReporter = (ctx) => {
    observer.emit({
      type: PipelineEventType.ErrorReported,
      priority: ctx.severity === "fatal" ? PipelinePriority.CRITICAL : PipelinePriority.HIGH,
      payload: ctx,
      timestamp: Date.now()});
  };
  for (const a of [codeAgent, reviewAgent, inspectorAgent, browserAgent, analysisAgent, docGovernAgent, loopAgent, opsAgent, apiAgent, dataAgent]) {
    a.setSafeReporter(safeReporter);
  }
  strategistAgent.setSafeReporter(safeReporter);
  shuangningAgent.setSafeReporter(safeReporter);
  console.log("   🛡️ SafeReporter 已注入 12 位审视委员——静默吞错终结。\n");

  // ═══════════════════════════════════════════════
  // Phase 0：HCA 预读上轮共识基线
  //   在甘雨规划之前，用 HCA（广度浅读）扫描上一轮共识修复清单，
  //   提取已收敛的关键决策作为本次审视的"地面真相基线"。
  //   这避免了两类认知偏差：
  //     1. 情境重置失忆——忘了上轮决定了什么
  //     2. 重复诊断——把已闭合项当成新问题重新审视
  // ═══════════════════════════════════════════════

  let phase0Baseline = "";
  const fixListPath = path.join(ROOT, "test-output", "self-examination-soft", "consensus-fix-list.md");
  
  if (!SOFT_MODE && fs.existsSync(fixListPath)) {
    console.log("🟡 [第零阶段] HCA 预读上轮共识基线...");
    const rawFixList = fs.readFileSync(fixListPath, "utf-8");

    // 提取 ✅ 已闭合节（地面真相——这些不需要再审视）
    const closedMatch = rawFixList.match(/### ✅ 已闭合[\s\S]*?(?=###|## 📜|$)/);
    const closedItems = closedMatch
      ? closedMatch[0]
          .split("\n")
          .filter((l) => l.trim().startsWith("- ✅"))
          .map((l) => l.trim())
      : [];

    // 提取 P0 阻断项（需优先验证）
    const p0Match = rawFixList.match(/### P0[\s\S]*?(?=### P1|### ✅|## 📜|$)/);
    const p0Items = p0Match
      ? p0Match[0]
          .split("\n")
          .filter((l) => l.trim().startsWith("- [") && !l.includes("[x]"))
          .map((l) => l.trim())
      : [];

    if (closedItems.length > 0 || p0Items.length > 0) {
      phase0Baseline = [
        "",
        "── 上轮共识基线（第零阶段 HCA 预读）──",
        "",
        "以下是上一轮圆桌会议已经收敛的共识。这些不是新的待办项——",
        "它们是本次审视的「地面真相」。你不需要重新审视已闭合项，",
        "也不需要把 P0 项当成新发现——上轮已经讨论过了。",
        "",
        ...(closedItems.length > 0
          ? [
              `✅ 已闭合（${closedItems.length} 项——这些已经确认修复，不应再出现在任何 Agent 的待修复报告中）：`,
              ...closedItems.map((item) => `  ${item}`),
              "",
            ]
          : []),
        ...(p0Items.length > 0
          ? [
              `🔴 待验证 P0 阻断项（${p0Items.length} 项——这些是上轮标为 P0 但尚未闭合的，需优先验证是否已落地）：`,
              ...p0Items.map((item) => `  ${item}`),
              "",
            ]
          : []),
        "你的任务：以上述基线为锚点，为专家们分配验证任务。",
        "每人只验证自己擅长领域内的未闭合项。已闭合项只做抽查——",
        "如果抽查发现某已闭合项实际上未修复，那是重大发现，优先级升为 P0。",
      ].join("\n");

      console.log(`   📋 已闭合: ${closedItems.length} 项  |  待验证 P0: ${p0Items.length} 项`);
      console.log(`   🧠 HCA 基线注入: ${phase0Baseline.length} 字符 → 甘雨规划上下文\n`);
    } else {
      console.log("   ℹ️ 共识修复清单存在但无可提取的基线项\n");
    }
  } else if (SOFT_MODE) {
    console.log("🟡 [第零阶段] 软约束模式——跳过共识基线预读，各 Agent 自由探索\n");
  } else {
    console.log("🟡 [第零阶段] 共识修复清单未找到——本次为首轮审视，无历史基线\n");
  }

  // ── 甘雨自规划 ──
  if (SOFT_MODE) {
    console.log("🟢 [第三阶段] 甘雨放弃清单——给每位专家发方向指引，让代码库自己说话...\n");
  } else {
    console.log("🟢 [第三阶段] 甘雨读取共识修复清单，规划验证任务...\n");
  }

  const fixListContent = SOFT_MODE
    ? "(软约束模式：不使用修复清单——各 Agent 自由探索整个代码库)"
    : (fs.existsSync(fixListPath) ? fs.readFileSync(fixListPath, "utf-8") : "(共识修复清单未找到)");

  // ═══════════════════════════════════════════════
  // 甘雨的意图——用中文思维叙述，让 MetaAgent 理解任务的「为什么」
  // 遵循六层框架：情境 → 身份 → 分寸 → 范围 → 信息 → 输出
  //
  // 技能模板加载：
  //   - 硬约束 (默认)：verification-templates.json —— 逐项验证清单
  //   - 软约束 (--soft)：verification-templates-soft.json —— 探索方向指引
  // 这是认知闭环的最小可验证单元——
  // 每次自审视完成后更新 JSON，下一次规划时自动获益。
  // ═══════════════════════════════════════════════

  const templatesFile = SOFT_MODE ? cortexConfig.selfExamination.templates.soft : cortexConfig.selfExamination.templates.hard;
  const templatesPath = path.join(SCRIPTS_DIR, "..", "config", templatesFile);
  let templatesLoaded = false;
  let templatesData: any = null;

  if (fs.existsSync(templatesPath)) {
    try {
      templatesData = JSON.parse(fs.readFileSync(templatesPath, "utf-8"));
      if (templatesData.templates && templatesData.templates.length >= 7) {
        templatesLoaded = true;
        console.log(`   📋 从 ${templatesFile} 加载 ${templatesData.templates.length} 条${SOFT_MODE ? "探索" : "验证"}技能模板\n`);
      } else {
        console.log(`   ⚠️ ${templatesFile} 模板数量异常，回退硬编码\n`);
      }
    } catch (e: any) {
      console.log(`   ⚠️ ${templatesFile} 解析失败: ${e.message}，回退硬编码\n`);
    }
  } else {
    console.log(`   ℹ️ ${templatesFile} 不存在，使用硬编码${SOFT_MODE ? "探索" : "验证"}指引\n`);
  }

  // ── 构建任务节点描述 ──
  function buildTaskLines(t: any, idx: number): string[] {
    return [
      `── 节点 ${idx + 1}：${t.name} (type=${t.type}) —— ${t.title} ──`,
      t.narrative,
      ...t.steps.map((s: string, i: number) => `${i + 1}. ${s}`),
      `每项输出：${t.outputFormat}`,
      `写出到 ${t.outputFile}`,
    ];
  }

  const taskBody = templatesLoaded
    ? templatesData.templates.flatMap((t: any, i: number) => buildTaskLines(t, i))
    : SOFT_MODE
      ? [
          // 回退：JSON 未加载时，使用软约束通用指引
          "没有修复清单。七位专家凭各自的专业直觉在代码库中自由探索。",
          "每个人从自己最敏锐的角度出发，发现代码、架构、工程、治理、模式中的一切值得关注的问题。",
          "不评分、不定级——只需如实报告。宁深挖一个真问题，不罗列十个假动作。",
          "各节点输出到 test-output/self-examination-soft/{agent-key}-*.md。",
        ]
      : [
          // 回退：JSON 未加载时，使用硬约束通用指引
          "请根据共识修复清单中的 P0-P3 条目，为七位专家各分配与其 type 匹配的验证任务。",
          "每位专家核查其对应优先级的条目是否已在代码层落地——不是改标记、不是加注释，是真改。",
          "各节点输出到 test-output/self-examination-soft/{agent-key}-verification.md。",
        ];

  // ── 意图组装 ──
  const intentParts: string[] = [];

  // Phase 0 基线注入：上轮共识作为规划锚点
  if (phase0Baseline) {
    intentParts.push(phase0Baseline);
  }

  if (SOFT_MODE) {
    // ═══ 软约束意图：自由探索 ═══
    const softIntentPath = path.join(SCRIPTS_DIR, "..", "config", "plan-intent-soft.txt");
    if (fs.existsSync(softIntentPath)) {
      intentParts.push(...fs.readFileSync(softIntentPath, "utf-8").split("\n"));
    }
  } else {
    // ═══ 硬约束意图：逐项验证 ═══
    const hardIntentPath = path.join(SCRIPTS_DIR, "..", "config", "plan-intent-hard.txt");
    if (fs.existsSync(hardIntentPath)) {
      intentParts.push(...fs.readFileSync(hardIntentPath, "utf-8").split("\n"));
    }
  }

  // 第五层：具体任务信息——由技能模板注入（双模式共用）
  intentParts.push(...taskBody, "");

  // 第六层：输出规范（双模式共用）
  intentParts.push(
    "以上七个节点全部设为根（无 parentId），全并行执行。",
    "每个节点的 payload 自包含——不需要读其他节点的结果才能开工。",
    "甘雨只做分派和最终的汇总摘要，不对专家的判断做二次加工。",
  );

  const intent = intentParts.join("\n");

  console.log("   📋 审视任务:");
  console.log(`   ${intent.split("\n").slice(0, 8).join("\n").slice(0, 300)}...\n`);

  console.log("   🌙 甘雨正在规划...");
  const planStart = Date.now();
  let nodes: TaskNode[] = [];
  try {
    nodes = await metaAgent.plan(intent, {
      existingTags: ["code", "review", "inspector", "analysis", "doc-govern", "ops", "loop"]});
  } catch (e) {
    console.error(`   ❌ MetaAgent 规划失败: ${e}`);
    process.exit(1);
  }
  console.log(`   ✅ 规划完成 (${Date.now() - planStart}ms): ${nodes.length} 个任务节点\n`);

  if (nodes.length === 0) {
    console.error("   ❌ MetaAgent 未生成任何任务节点——请检查上方日志");
    process.exit(1);
  }

  for (const n of nodes) {
    const parent = n.parentId ? ` → child of [${n.parentId.slice(0, 16)}]` : " → root";
    console.log(`     [${n.type}] ${n.tags.join(", ")}  ${n.id}${parent}`);
    const payloadPreview = n.payload.slice(0, 120);
    console.log(`        ${payloadPreview}...`);
  }

  // 依赖结构诊断
  const roots = nodes.filter((n) => !n.parentId);
  const nonRoots = nodes.filter((n) => n.parentId);
  console.log(`\n   🌳 依赖结构: ${roots.length} 个根节点, ${nonRoots.length} 个子节点`);
  if (nonRoots.length === 0) {
    console.log("   ⚠️ 诊断：所有节点都是根节点——甘雨没有建立时序依赖！\n");
  } else {
    const byParentId = new Map<string, TaskNode[]>();
    for (const n of nodes) {
      if (n.parentId) {
        const existing = byParentId.get(n.parentId);
        if (existing) existing.push(n);
        else byParentId.set(n.parentId, [n]);
      }
    }
    let layer = 0;
    let current = roots;
    while (current.length > 0) {
      console.log(
        `   Layer ${layer}: ${current.map((n) => agentName(n.tags[0] ?? n.type).split(" ")[0]).join(" | ")}`,
      );
      const next: TaskNode[] = [];
      for (const n of current) {
        const children = byParentId.get(n.id);
        if (children) next.push(...children);
      }
      current = next;
      layer++;
    }
    console.log();
  }

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
  console.log(SOFT_MODE ? "🟢 [第四阶段] 审视委员会开始探索...\n" : "🟢 [第四阶段] 审视委员会开始工作...\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const execStart = Date.now();
  const report = await scheduler.executeAll();
  const execDuration = Date.now() - execStart;

  // ── 结果汇总 ──
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  📊 审视结果                                     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`   完成: ${report.completed}  失败: ${report.failed}  耗时: ${execDuration}ms`);
  console.log();

  const allNodes = board.getAllNodes();
  for (const n of allNodes) {
    const status = n.status === "done" ? "✅" : n.status === "failed" ? "❌" : "⏳";
    const label = agentName(n.results[0]?.agentType ?? n.tags[0]);
    console.log(`   ${status} [${n.type}] ${n.tags.join(", ")}  ${label}`);
  }
  console.log();

  // ── 专家发言实录 ──
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  🎭 审视委员会发言实录                            ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  for (const n of allNodes) {
    if (n.results.length === 0 || n.status === "pending") continue;
    const r = n.results[0];
    const label = agentName(r.agentType ?? "unknown");
    const content = (r.output ?? r.error ?? "(无输出)").trim();

    const statusMark = r.success ? "✅" : "❌";
    console.log(`── ${statusMark} ${label} ──`);
    const indent = "   ";
    const maxLines = 500;
    const lines = content.split("\n");
    const displayLines = lines.slice(0, maxLines);
    for (const line of displayLines) {
      console.log(`${indent}${line}`);
    }
    if (lines.length > maxLines) {
      console.log(`${indent}... (截断，共 ${lines.length} 行，仅显示前 ${maxLines} 行)`);
    }
    console.log();
  }

  // ── 审视产出文件 ──
  console.log("── 审视产出文件 ──");
  if (fs.existsSync(OUTPUT_DIR)) {
    const files = fs.readdirSync(OUTPUT_DIR, { recursive: true }) as string[];
    if (files.length === 0) {
      console.log("   (空目录——审视委员会未产出任何文件)\n");
    } else {
      for (const f of files) {
        const fp = path.join(OUTPUT_DIR, f);
        const stat = fs.statSync(fp);
        if (stat.isFile()) {
          console.log(`   📄 ${f}  (${stat.size} bytes)`);
        }
      }
    }
  }
  console.log();

  // ── 聚合摘要：自审视闭环输出 ──
  const SUMMARY_PATH = path.join(OUTPUT_DIR, "self-examination-summary.md");
  const fixListLabel = SOFT_MODE
    ? "(软约束自由审视——无修复清单)"
    : fixListPath;
  writeExaminationSummary(OUTPUT_DIR, report, execDuration, fixListLabel, SUMMARY_PATH, SOFT_MODE);
  console.log();

  // ═══════════════════════════════════════════════
  // 4.25 交叉验证 Second-Pass（仅软约束模式）
  //   在圆桌共识前，由互补专长的 Agent 对彼此报告中的可验证事实声明
  //   做 search_code / read_file 级别的核查。将 LLM 推理与可验证事实分离。
  // ═══════════════════════════════════════════════

  if (SOFT_MODE) {
    console.log("🟢 [第四阶段·交叉验证] 互补专长 Agent 互相验证可验证事实声明...\n");

    const crossVerifyPairs = loadCrossVerifyPairs(
      path.join(SCRIPTS_DIR, "..", "config"),
    );

    const verifierAgents: Record<string, VerifierAgent> = {
      keqing: reviewAgent,
      nahida: analysisAgent,
      amber: inspectorAgent,
      beidou: opsAgent,
      mona: loopAgent,
      kuki: apiAgent,
      alhaitham: dataAgent,
      albedo: codeAgent};

    const verifyFiles = await runCrossVerification(
      OUTPUT_DIR,
      crossVerifyPairs,
      verifierAgents,
      CHAT_MODEL,
    );

    // 重新生成摘要以包含交叉验证产出
    if (verifyFiles.length > 0) {
      writeExaminationSummary(OUTPUT_DIR, report, execDuration, fixListLabel, SUMMARY_PATH, SOFT_MODE);
      console.log();
    }
  }

  // ═══════════════════════════════════════════════
  // 4.5 钟离战略分析 + 霜凝方向监理（仅软约束模式）
  // ═══════════════════════════════════════════════

  if (SOFT_MODE) {
    await runStrategyAnalysis(
      OUTPUT_DIR,
      strategistAgent,
      shuangningAgent,
      CHAT_MODEL,
    );
  }

  // ═══════════════════════════════════════════════
  // 5. 第五阶段——硬约束共识圆桌（软约束自审视 → 共识修复清单）
  //   仅软约束模式下触发。
  //   10 位 Agent 全员入席：探索 7 人 + 甘雨 + 托马 + 宵宫
  //   流程：
  //     1. 读取 7 份审视报告 → 提取摘要
  //     2. 注入为 MemoryStore 种子记忆（Agent 发言时可回溯）
  //     3. 三轮硬约束圆桌 → 凝光收束签署
  //     4. 覆写 test-output/self-examination-soft/consensus-fix-list.md
  //   产出：标准 P0-P3 共识修复清单，可供下一轮硬约束验证直接使用
  // ═══════════════════════════════════════════════

  if (SOFT_MODE) {
    console.log("🟢 [第五阶段] 硬约束共识圆桌...");
    console.log("   入席者: 刻晴 阿贝多 纳西妲 凝光 莫娜 安柏 北斗 久岐忍 艾尔海森");
    console.log("   制度: 单轮合并 · 每人 3-5 次发言 · 凝光收束签署 · 产出共识修复清单\n");

    const CONSENSUS_OUTPUT = path.join(ROOT, cortexConfig.selfExamination.consensusOutput);
    const DB_DIR = path.join(ROOT, ".cortex");

    // ── 1. 读取审视报告，用上下文压缩器替代粗暴截断 ──
    let reportDigest = "";
    const consensusKeys = cortexConfig.selfExamination.consensusAgents;
    const agentReportMap: Record<string, { key: string; label: string; emoji: string }> = {};
    for (const k of consensusKeys) {
      const agent = (cortexConfig.agents as Record<string, { display?: { emoji: string; shortName: string } }>)[k];
      if (agent?.display) agentReportMap[k] = { key: k, label: agent.display.shortName, emoji: agent.display.emoji };
    }

    // 收集所有报告内容
    const reportInputs: Array<{ agentKey: string; label: string; emoji: string; content: string }> = [];
    if (fs.existsSync(OUTPUT_DIR)) {
      const files = fs.readdirSync(OUTPUT_DIR);
      for (const [key, info] of Object.entries(agentReportMap)) {
        const reportFile = files.find(
          (f) => f.includes(key) && f.endsWith(".md") && !f.includes("summary") && !f.includes("roundtable")
        );
        if (!reportFile) {
          console.log(`   ⚠️ 未找到 ${info.emoji}${info.label} 的审视报告，跳过`);
          continue;
        }
        const reportPath = path.join(OUTPUT_DIR, reportFile);
        try {
          const rawContent = fs.readFileSync(reportPath, "utf-8");
          reportInputs.push({ agentKey: key, label: info.label, emoji: info.emoji, content: rawContent });
          console.log(`   📄 ${info.emoji}${info.label}: ${reportFile} (${rawContent.length} 字符)`);
        } catch (e) {
          console.log(`   ⚠️ ${info.emoji}${info.label} 报告读取失败: ${String(e)}`);
        }
      }
    }

    // 结构化压缩
    const { compressed, aggregateSummary } = compressForRoundtable(reportInputs, 16_000);
    reportDigest = aggregateSummary;

    // 打印压缩统计
    for (const c of compressed) {
      const ratio = ((1 - c.compressedLength / Math.max(c.rawLength, 1)) * 100).toFixed(0);
      console.log(`   📊 ${c.emoji}${c.label}: ${c.rawLength}→${c.compressedLength} 字符 (压缩 ${ratio}%) | ✅${c.stats.confirmed} ⚠️${c.stats.warning} ❌${c.stats.falsified} 🔧${c.stats.runtimeNeeded} ❓${c.stats.insufficient}`);
    }
    console.log(`   🌱 共 ${compressed.length} 份报告经结构化压缩注入 topic\n`);

    // ── 2. 将报告摘要注入 topic，不经过 MemoryStore 中转 ──
    const origTopic = SOFT_CONSENSUS_ROUNDTABLE.rounds[0].topic;
    const enrichedTopic = origTopic + "\n\n─── 各 Agent 审视报告摘要（请优先阅读，作为发现陈述的依据）───" + reportDigest;
    SOFT_CONSENSUS_ROUNDTABLE.rounds[0].topic = enrichedTopic;

    // ── 3. 运行硬约束共识圆桌（不传 seedMemories）───
    try {
      await runMeeting(
        SOFT_CONSENSUS_ROUNDTABLE,
        adapter,
        CHAT_MODEL,
        DB_DIR,
        CONSENSUS_OUTPUT,
      );
      console.log(`   📝 共识修复清单: ${CONSENSUS_OUTPUT}\n`);
      console.log(`   💡 下一轮运行硬约束验证时，将自动读取此清单。\n`);
    } catch (e) {
      console.error(`   ❌ 共识圆桌失败: ${String(e).slice(0, 200)}`);
    }
  }

  // ── 记忆系统诊断 ──
  console.log("── 记忆系统诊断 ──");
  const allMemories = await memory.read({});
  const accessed = allMemories.filter((m) => m.lastAccessedAt > m.createdAt + 1000);
  console.log(`   总记忆: ${allMemories.length}  被访问过: ${accessed.length}`);
  if (accessed.length > 0) {
    for (const m of accessed) {
      console.log(`     📖 ${m.summary.slice(0, 120)}`);
    }
  } else {
    console.log("   ⚠️ 没有记忆被 Agent 主动访问——审视委员会可能未利用记忆系统");
  }
  console.log();

  // ── 清理 ──
  try {
    await browserAgent.shutdown();
  } catch {
    /* 静默 */
  }

  // ── 自动清库归档（防止记忆污染）──
  console.log("── 清理与归档 ──");

  // 1. 删除本轮专属数据库
  const cleanupFiles = cortexConfig.selfExamination.cleanupFiles;
  let cleanedCount = 0;
  for (const f of cleanupFiles) {
    const fp = path.join(ROOT, ".cortex", f);
    if (fs.existsSync(fp)) {
      try {
        fs.unlinkSync(fp);
        cleanedCount++;
        console.log(`   🧹 已清理 ${f}`);
      } catch (e) {
        console.log(`   ⚠️ 清理 ${f} 失败: ${String(e)}`);
      }
    }
  }
  if (cleanedCount === 0) console.log("   ℹ️ 无待清理的临时数据库");

  // 2. 归档报告
  const archiveBase = path.join(ROOT, cortexConfig.selfExamination.archiveBase);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const archiveDir = path.join(archiveBase, `self-examination-${timestamp}`);
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

  for (const outputSubdir of [cortexConfig.selfExamination.outputDir.hard, cortexConfig.selfExamination.outputDir.soft]) {
    const src = path.join(ROOT, outputSubdir);
    const dirName = outputSubdir.split("/").pop()!;
    if (fs.existsSync(src)) {
      const files = fs.readdirSync(src);
      for (const f of files) {
        const srcFp = path.join(src, f);
        try {
          if (fs.statSync(srcFp).isFile()) {
            const dstFp = path.join(archiveDir, `${dirName}__${f}`);
            fs.copyFileSync(srcFp, dstFp);
            fs.unlinkSync(srcFp);
          }
        } catch (e) {
          console.log(`   ⚠️ 归档 ${f} 失败: ${String(e)}`);
        }
      }
    }
  }
  console.log(`   📦 报告已归档至 ${archiveDir}`);

  console.log(`   全流程耗时: ${execDuration}ms\n`);
}

main().catch((err) => {
  console.error("Cortex 自审视实验异常终止", err);
  process.exit(1);
});
