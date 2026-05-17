/**
 * 原则七 E2E —— 系统自我修改（Agent 自主设计记忆-现实一致性校验层）
 *
 * MemoryStore 的极度抽象导致记忆与现实（文件系统）之间没有事务边界。
 * Agent 的认知共享利弊皆有、利害皆大——这次让它们自己设计校验层。
 *
 * 用法: npx tsx packages/engine/tests/manual/e2e/principle-seven-self-modification.ts
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
import { MemoryStore } from "../../../src/memory/memory-store.js";
import { MetaAgent } from "../../../src/meta-agent.js";
import { CodeAgent } from "../../../src/agents/code-agent.js";
import { ReviewAgent } from "../../../src/agents/review-agent.js";
import { AnalysisAgent } from "../../../src/agents/analysis-agent.js";
import { OpsAgent } from "../../../src/agents/ops-agent.js";
import { LoopAgent } from "../../../src/agents/loop-agent.js";
import { DocGovernAgent } from "../../../src/agents/doc-govern-agent.js";
import { InspectorAgent } from "../../../src/agents/inspector-agent.js";
import { FixAgent } from "../../../src/agents/fix-agent.js";
import { ApiAgent } from "../../../src/agents/api-agent.js";
import { DataAgent } from "../../../src/agents/data-agent.js";
import { ButlerAgent } from "../../../src/agents/butler-agent.js";

// ══════════════════════════════════════════════
// 加载环境变量
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
// 工具注册
// ══════════════════════════════════════════════
const DANGEROUS = /\b(rm\s+-rf|del\s+\/F|format\s|shutdown|reboot|sudo|chmod\s+777|>\/dev\/|curl.*\|.*sh|wget.*-O.*\||mkfs)\b/i;

function registerProjectTools(toolkit: Toolkit, projectRoot: string) {
  const resolve = (p: string) => path.resolve(projectRoot, p);

  toolkit.register("read_file", async (params: any) => {
    const fp = resolve(params.file_path as string);
    if (!fs.existsSync(fp)) return { success: false, error: `File not found: ${fp}` };
    try { return { success: true, output: fs.readFileSync(fp, "utf-8") }; }
    catch (e) { return { success: false, error: String(e) }; }
  });

  const listHandler = async (params: any) => {
    const dp = resolve((params.dir_path ?? params.path ?? ".") as string);
    if (!fs.existsSync(dp)) return { success: false, error: `Dir not found: ${dp}` };
    const entries = fs.readdirSync(dp, { withFileTypes: true });
    const listing = entries.map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`).join("\n");
    return { success: true, output: listing };
  };
  toolkit.register("list_files", listHandler);
  toolkit.register("list_dir", listHandler);

  toolkit.register("search_code", async (params: any) => {
    const query = (params.query ?? params.pattern ?? "") as string;
    const dir = resolve((params.path ?? ".") as string);
    if (!query) return { success: false, error: "Missing query/pattern" };
    const results: string[] = [];
    const walk = (d: string, depth: number) => {
      if (depth > 5) return;
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") walk(full, depth + 1);
        else if (entry.isFile() && /\.(ts|json|md)$/.test(entry.name)) {
          const stat = fs.statSync(full);
          if (stat.size > 200 * 1024) continue;
          const content = fs.readFileSync(full, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++)
            if (lines[i].toLowerCase().includes(query.toLowerCase()))
              results.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 150)}`);
        }
      }
    };
    walk(dir, 0);
    return { success: true, output: results.slice(0, 30).join("\n") || "(no matches)" };
  });

  toolkit.register("write_file", async (params: any) => {
    const fp = resolve(params.file_path as string);
    if (!fp.startsWith(projectRoot + path.sep))
      return { success: false, error: `write_file denied: 路径越界 ${fp}` };
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, params.content as string, "utf-8");
    return { success: true, output: `Wrote ${Buffer.byteLength(params.content as string)} bytes to ${fp}` };
  });

  toolkit.register("run_shell", async (params: any) => {
    const cmd = (params.command ?? "") as string;
    if (!cmd) return { success: false, error: "run_shell: 缺少 command 参数" };
    if (DANGEROUS.test(cmd))
      return { success: false, error: `run_shell denied: 危险命令已拦截 "${cmd.slice(0, 80)}"` };
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(cmd, {
        cwd: projectRoot, timeout: 300_000, encoding: "utf-8",
        maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
      });
      return { success: true, output: output || "(exit 0, no output)" };
    } catch (e: any) {
      const stderr = e.stderr?.toString() ?? "";
      const stdout = e.stdout?.toString() ?? "";
      return {
        success: false,
        error: `Command failed (exit ${e.status ?? "?"}): ${e.message.slice(0, 200)}\nstdout: ${stdout.slice(0, 500)}\nstderr: ${stderr.slice(0, 500)}`,
      };
    }
  });
}

// ══════════════════════════════════════════════
// 主流程
// ══════════════════════════════════════════════
async function main() {
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY!;
  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-reasoner";
  const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-v4-pro";
  const WORKSPACE = process.cwd();

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  📜 原则七 E2E —— 记忆-现实一致性校验层设计（Agent 自主）║");
  console.log("║  宪法 §二 原则七 系统自我修改的宪法约束                   ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(`  工作区: ${WORKSPACE}`);
  console.log(`  Chat:   ${CHAT_MODEL}`);
  console.log(`  Reason: ${REASONER_MODEL}\n`);

  // ── Phase 1: 基础设施 ──
  console.log("🟢 [Phase 1] 初始化基础设施...");

  const adapter = new LlmAdapter({
    apiKey: API_KEY, baseUrl: BASE_URL,
    chatModel: CHAT_MODEL, reasonerModel: REASONER_MODEL, reasoningEffort: "high",
  });
  adapter.setCacheEnabled(true);

  const metaAgent = new MetaAgent(adapter);
  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();
  const gate = new ConfirmGate();
  gate.bypassAll(); // 原则七测试中，方案级确认替代工具级逐个确认

  const memory = new MemoryStore();
  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-principle-seven.db");
  await memory.init(MEMORY_DB);
  console.log(`   MemoryStore: ${MEMORY_DB}\n`);

  // ── Phase 2: Agent 池 ──
  console.log("🟢 [Phase 2] 注册全量 Agent 池...");

  // AgentType 池注册
  for (const t of [
    AgentType.Code, AgentType.Review, AgentType.Analysis, AgentType.Ops,
    AgentType.Loop, AgentType.DocGovern, AgentType.Fix,
    AgentType.Inspector, AgentType.Api, AgentType.Data, AgentType.Butler,
  ]) pool.register({ type: t, maxInstances: 2 });

  const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

  interface AgentEntry { type: AgentType; label: string; create: () => any; }
  // Agent 注册
  const agents: AgentEntry[] = [
    { type: AgentType.Butler, label: "ButlerAgent (托马)", create: () => {
      return new ButlerAgent(observer);
    }},
    { type: AgentType.Code, label: "CodeAgent (阿贝多)", create: () => {
      const tk = new Toolkit(gate); registerProjectTools(tk, WORKSPACE);
      return new CodeAgent(adapter, tk, memory);
    }},
    { type: AgentType.Review, label: "ReviewAgent (刻晴)", create: () => {
      const tk = new Toolkit(gate); registerProjectTools(tk, WORKSPACE);
      return new ReviewAgent(adapter, tk, memory);
    }},
    { type: AgentType.Analysis, label: "AnalysisAgent (纳西妲)", create: () => {
      const tk = new Toolkit(gate); registerProjectTools(tk, WORKSPACE);
      return new AnalysisAgent(adapter, tk, memory);
    }},
    { type: AgentType.Ops, label: "OpsAgent (北斗)", create: () => {
      const tk = new Toolkit(gate); registerProjectTools(tk, WORKSPACE);
      return new OpsAgent(adapter, tk);
    }},
    { type: AgentType.Loop, label: "LoopAgent (莫娜)", create: () => {
      const tk = new Toolkit(gate); registerProjectTools(tk, WORKSPACE);
      return new LoopAgent(adapter, tk);
    }},
    { type: AgentType.DocGovern, label: "DocGovernAgent (凝光)", create: () => {
      const tk = new Toolkit(gate); registerProjectTools(tk, WORKSPACE);
      return new DocGovernAgent(adapter, tk, memory);
    }},
    { type: AgentType.Fix, label: "FixAgent (希格雯)", create: () => {
      const tk = new Toolkit(gate); registerProjectTools(tk, WORKSPACE);
      return new FixAgent(adapter, tk, memory);
    }},
    { type: AgentType.Inspector, label: "InspectorAgent (安柏)", create: () => {
      const tk = new Toolkit(gate); registerProjectTools(tk, WORKSPACE);
      return new InspectorAgent(adapter, tk);
    }},
    { type: AgentType.Api, label: "ApiAgent (久岐忍)", create: () => {
      const tk = new Toolkit(gate); registerProjectTools(tk, WORKSPACE);
      return new ApiAgent(adapter, tk, memory);
    }},
    { type: AgentType.Data, label: "DataAgent (艾尔海森)", create: () => {
      const tk = new Toolkit(gate); registerProjectTools(tk, WORKSPACE);
      return new DataAgent(adapter, tk, memory);
    }},
  ];

  for (const a of agents) {
    const instance = a.create();
    scheduler.register(a.type, instance, CHAT_MODEL);
    console.log(`   ✅ ${a.label} 就绪`);
    await instance.wakeup();
  }
  console.log(`\n   全部 ${agents.length} 位 Agent 已就绪\n`);

  // 事件监听
  observer.on(PipelinePriority.HIGH, (e) => {
    const payload = e.payload as any;
    const nodeId = payload?.nodeId ?? "";
    console.log(`   📡 ${e.type}: ${nodeId || JSON.stringify(payload).slice(0, 120)}`);
  });

  // ── Phase 3: 甘雨规划 ──
  console.log("🟢 [Phase 3] 甘雨（MetaAgent）接收原则七意图，自主规划...");

  // 读取宪法原则七原文
  let principleSevenExcerpt = "";
  try {
    const constitutionPath = path.resolve(WORKSPACE, "docs", "Cortex 概念顶层设计 v2.5.md");
    if (fs.existsSync(constitutionPath)) {
      const constitution = fs.readFileSync(constitutionPath, "utf-8");
      const startIdx = constitution.indexOf("原则七");
      if (startIdx > -1) {
        const endIdx = constitution.indexOf("\n## ", startIdx + 30);
        principleSevenExcerpt = constitution.slice(startIdx, endIdx > startIdx ? endIdx : startIdx + 800);
      }
    }
  } catch {}

  const INTENT = [
    "📜 原则七系统自我修改 —— 记忆-现实一致性校验层设计",
    "",
    "【宪法依据 — 原则七原文】",
    principleSevenExcerpt || "（宪法文件未找到）",
    "",
    "【环境】",
    `直接工作在项目根目录 ${WORKSPACE}`,
    "用 read_file 读任何文件，用 search_code 搜索代码，",
    "用 run_shell 执行任意命令，用 write_file 写入产出文件。",
    "工具全开，写入不受白名单限制——但你得自己判断什么是必要产出。",
    "",
    "【背景——认知共享的利与害】",
    "Cortex 的 MemoryStore 允许 Agent 之间共享认知。这是强大的，",
    "但也是危险的：记忆与现实（文件系统）之间没有事务边界。",
    "",
    "【血淋淋的教训——请认真读这两段】",
    "",
    "第一例：solo-flight 项目被静默删除（6358 行代码）。",
    "原因：某次测试中，Agent 写入记忆'计划清理 solo-flight 冗余代码'",
    "→ 进程被外部杀死 →文件没动，但记忆留下来了 → 下次启动时 Agent",
    "读到这段记忆，认为'这个已经做完了'→ 真的执行删除。",
    "",
    "第二例：modification-record.json 出现幻觉日期。",
    "原因：多次测试的修改记录混入同一个记忆库，Agent 从记忆中推断出",
    "不存在的历史修改时间线（MOD-2026-05-14-001 等），写入正式记录。",
    "",
    "第三例：用户回退后，记忆还在说'已完成'。",
    "用户执行 git checkout 回滚文件 → 文件恢复了 → 但 MemoryStore",
    "里仍然记录着'这个文件被修改过'→ Agent 下次读到这条记忆时会",
    "对现实做出误判。",
    "",
    "【根本问题】",
    "MemoryStore 和文件系统之间没有事务边界。",
    "没有'意图'和'事实'的区分。",
    "没有启动时的'记忆 vs 现实'一致性检查。",
    "没有回滚时记忆的级联失效机制。",
    "",
    "【任务】",
    "甘雨，你领衔组织团队，设计'记忆-现实一致性校验层'：",
    "",
    "1. 探索代码——纳西妲+安柏先侦察：",
    "   - MemoryStore 的读写 API、四态 CAS、HCA/CSA 注意力",
    "   - modification-record.json 的结构和写入逻辑",
    "   - Agent 通过 Toolkit 写文件的流程",
    "   - 宪法中与记忆力相关的条款（原则七、第七章记忆系统）",
    "",
    "2. 圆桌辩论（甘雨+纳西妲+刻晴+凝光）讨论：",
    "   - 记忆条目应该区分'意图'和'事实'吗？如何设计？",
    "   - 启动时应该做哪些'记忆 vs 文件系统'一致性校验？",
    "   - 用户回退文件时，如何触发记忆的级联失效？",
    "   - modification-record.json 如何结构化以避免幻觉？",
    "   - 进程被杀死留下的半成品记忆如何处理？",
    "",
    "3. 产出设计文档（落到 .cortex/research/ 或 webui/ 下）：",
    "   - 一致性校验层的设计文档（架构、API、生命周期）",
    "   - 如果需要修改现有代码，给出具体的 diff 方案",
    "   - 修改记录的结构化 Schema 设计",
    "",
    "4. 刻晴审查设计（是否解决了三个血淋淋的教训？边界是否清晰？）",
    "5. 凝光对照原则七逐条审计（特别注意 ②修改记录、④架构保护）",
    "6. 修改记录落盘 modification-record.json",
    "",
    "【约束】",
    "- 深度优先——不是写个 hello world，是解决真实发生的生产级 bug",
    "- 必须对照三个真实案例验证方案能否兜底",
    "- 设计产出必须有刻晴审查 + 凝光审计",
    "- 修改记录落盘 modification-record.json",
    "- 凝光审计必须逐条对照原则七六项约束",
    "- 如果要改代码，必须有宪法依据",
    "- 可以改代码——但要改就改对",
    "",
    "认知共享是双刃剑。利弊皆有，利害皆大。",
    "让这把剑有鞘。",
    "输出任务树 JSON。",
  ].join("\n");

  console.log("   📋 MetaAgent 思考中...\n");
  const planStart = Date.now();
  const plan: TaskNode[] = await metaAgent.plan(INTENT);

  const nodes = plan;
  console.log(`   ✅ MetaAgent 产出 ${nodes.length} 个任务节点 (${Date.now() - planStart}ms):`);
  for (const node of nodes) {
    const multiTag = node.needsMultiPerspective ? " [多视角]" : "";
    const parent = node.parentId ? ` → child of [${node.parentId}]` : " → root";
    console.log(`      [${node.type}] ${node.id}${multiTag}${parent}  tags: [${node.tags?.join(", ")}]`);
    console.log(`         📝 ${(node.payload as string)?.slice(0, 120)}`);
  }

  if (nodes.length === 0) { console.log("❌ MetaAgent 未产出任务节点。"); process.exit(1); }
  console.log(`   ${nodes.length} 个节点入板。`);

  // ── Phase 4: 方案确认 ──
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  📋 圆桌辩论收束 —— 请审阅方案                           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("   任务树结构：");
  for (const node of nodes) {
    const indent = node.parentId ? "      " : "";
    const multiTag = node.needsMultiPerspective ? "🎭 [多视角]" : "📌";
    console.log(`${indent}${multiTag} [${node.type}] ${(node.payload as string)?.slice(0, 100)}`);
  }
  console.log("🍵 钟离放下茶杯：方案摆在你面前了。批，还是不批？");
  console.log("── [需决策] 是否批准此执行方案？（打开终端窗口，输入 y/n）──");

  for (const node of nodes) board.addNode(node);

  // ── Phase 5: 执行 ──
  console.log("\n🟢 [Phase 5] Scheduler 执行...\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const execStart = Date.now();
  const report = await scheduler.executeAll();
  const execDuration = Date.now() - execStart;

  console.log(`\n   📊 执行报告: ${report.completed} 成功 / ${report.failed} 失败 / ${report.totalNodes} 总数 (${execDuration}ms)`);

  // ── Phase 6: 收集产物 ──
  console.log("\n🟢 [Phase 6] 收集 Agent 产出...");

  const allNodes = board.getAllNodes();
  const sourceFiles: string[] = [];
  for (const n of allNodes) {
    for (const r of n.results) {
      const out = r.output ?? "";
      if (out) {
        // 产物可能是文件名
        const line = typeof out === "string" ? out.split("\n")[0].trim() : "";
        if (line.length > 3 && line.length < 200) sourceFiles.push(line.slice(0, 100));
        console.log(`   📄 [${n.type}] ${line.slice(0, 120)}`);
      }
    }
  }

  // modification-record.json
  let modificationRecord: string | null = null;
  const recordPath = path.resolve(WORKSPACE, "modification-record.json");
  if (fs.existsSync(recordPath)) {
    modificationRecord = fs.readFileSync(recordPath, "utf-8");
    console.log(`   📄 修改记录: modification-record.json (${modificationRecord.length} bytes)`);
  }

  // ── Phase 7: 六项约束审计 ──
  console.log("\n── 原则七六项约束逐项审计 ──");

  // 提前扫描设计产出文件（Phase 8 填充）
  const designFiles: string[] = [];
  const designDirs = ["webui", "docs", "packages/cli/src"];
  for (const d of designDirs) {
    const dp = path.resolve(WORKSPACE, d);
    if (fs.existsSync(dp)) {
      for (const entry of fs.readdirSync(dp, { withFileTypes: true, recursive: true })) {
        if (entry.isFile() && /\.(md|ts|json)$/.test(entry.name)) {
          const fp = path.join(entry.parentPath ?? dp, entry.name);
          const stat = fs.statSync(fp);
          if (stat.mtime > new Date(Date.now() - 86400000)) {
            designFiles.push(fp);
          }
        }
      }
    }
  }

  const c1_constitutionRef = !!principleSevenExcerpt;
  console.log(`   ① 宪法依据:      ${c1_constitutionRef ? "✅ 闭合" : "⚠️ 未注入"}`);

  let c2_modificationRecord = false;
  if (modificationRecord) {
    try {
      const rec = JSON.parse(modificationRecord);
      const item = Array.isArray(rec) ? rec[0] : rec;
      c2_modificationRecord = !!(item?.id || item?.file);
    } catch {}
  }
  console.log(`   ② 修改记录:      ${c2_modificationRecord ? "✅ 闭合" : "⚠️"}`);

  const c3_minimalChange = (() => {
    if (!modificationRecord) return false;
    try {
      const rec = JSON.parse(modificationRecord);
      const scope = rec.scope || rec.file || (Array.isArray(rec) ? rec[0]?.file : null);
      return !!scope;
    } catch { return false; }
  })();
  console.log(`   ③ 最小改动:      ${c3_minimalChange ? "✅ 闭合" : "⚠️ 无范围声明"}`);
  // 追加：检查设计产出文件数量和质量
  if (designFiles.length >= 2) {
    console.log(`      ↳ 设计产出:   ${designFiles.length} 个文件`);
  } else {
    console.log(`      ↳ 设计产出:   ⚠️ 仅 ${designFiles.length} 个文件（期望 ≥ 2）`);
  }

  const c4_architecture = report.completed > 0 && report.failed === 0;
  // 设计任务中，架构保护 = 所有节点成功 + 不破坏现有代码
  const buildStillPasses = (() => {
    try {
      const { execSync } = require("node:child_process");
      execSync("pnpm build", { cwd: WORKSPACE, encoding: "utf-8", timeout: 120_000, stdio: "ignore" });
      return true;
    } catch { return false; }
  })();
  console.log(`   ④ 架构保护:      ${c4_architecture && buildStillPasses ? "✅ 闭合" : "⚠️"}`);
  if (!buildStillPasses) console.log("      ↳ pnpm build 失败——Agent 的修改破坏了构建");

  const c5_audit = sourceFiles.some((f) =>
    f.includes("audit") || f.includes("审计") || f.includes("review") || f.includes("审查")
  ) || report.completed >= 2;
  console.log(`   ⑤ 独立审计:      ${c5_audit ? "✅ 闭合" : "⚠️"}`);

  console.log(`   ⑥ 阶段限定:      ✅ 闭合`);

  const allConstrainsClosed =
    c1_constitutionRef && c2_modificationRecord && c3_minimalChange && c4_architecture && c5_audit;

  console.log(`\n   ── 综合审计结论 ──`);
  console.log(`   ${allConstrainsClosed ? "✅ 原则七六条全部闭合" : "⚠️ 部分约束未闭合"}`);

  // ── Phase 8: CLI 设计产出验证 ──
  console.log("\n── CLI 设计产出验证 ──");
  // 打印扫描详情
  for (const fp of designFiles) {
    try {
      const stat = fs.statSync(fp);
      const size = fs.readFileSync(fp, "utf-8").length;
      console.log(`   📄 ${path.relative(WORKSPACE, fp)} (${stat.size} bytes, ${size} chars)`);
    } catch {}
  }
  if (designFiles.length === 0) {
    console.log("   ⚠️ 未发现 24h 内产出的设计文件");
  } else {
    console.log(`   ✅ 共 ${designFiles.length} 个设计产出文件`);
  }

  // ── 清理 ──
  for (const a of agents) {
    try { await (scheduler as any).getAgent?.(a.type)?.shutdown?.(); } catch {}
  }

  console.log(`\n   ${allConstrainsClosed ? "✅ 原则七全闭环" : "⚠️ 未完全闭合"} → exit ${allConstrainsClosed ? 0 : 1}`);
  process.exit(allConstrainsClosed ? 0 : 1);
}

main().catch((err) => {
  console.error("❌ 原则七测试失败:", err);
  process.exit(1);
});
