/**
 * 软约束共识圆桌 · 独立运行脚本
 *
 * 用法: npx tsx tests/manual/scripts/run-soft-consensus-roundtable.ts
 * 前提: Phase 4 已产出 7 份审视报告于 test-output/self-examination-soft/
 *
 * 仅运行 Phase 5——硬约束共识圆桌，13 位 Agent 入席，
 * 基于已有审视报告 + 根因归簇分析 + 钟离战略评估 → 产出 consensus-fix-list.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { AgentType, MemoryType, type SafeErrorReporter } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { runMeeting, SOFT_CONSENSUS_ROUNDTABLE, type SeedMemory } from "../config/roundtable-config";

// ═══════════════════════════════════════════════
// 1. 环境变量
// ═══════════════════════════════════════════════

function loadEnv() {
  const envPath = path.resolve(process.cwd(), "..", "..", ".env");
  if (!fs.existsSync(envPath)) {
    const alt = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(alt)) {
      const lines = fs.readFileSync(alt, "utf-8").split("\n");
      for (const line of lines) {
        const clean = line.replace(/\r$/, "");
        const m = clean.match(/^([^=]+)=(.*)$/);
        if (m) process.env[m[1]] = m[2].trim();
      }
      return;
    }
    console.error("错误：.env 文件不存在");
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const clean = line.replace(/\r$/, "");
    const m = clean.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

// ═══════════════════════════════════════════════
// 2. 主流程
// ═══════════════════════════════════════════════

async function main() {
  if (process.platform === "win32") {
    try { execSync("chcp 65001", { stdio: "pipe" }); } catch { /* 静默 */ }
  }

  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) {
    console.error("错误：DEEPSEEK_API_KEY 未设置");
    process.exit(1);
  }

  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-v4-flash";
  const REASONING_EFFORT = process.env.DEEPSEEK_REASONING_EFFORT ?? "high";

  const __filename = fileURLToPath(import.meta.url);
  const SCRIPTS_DIR = path.dirname(__filename);
  const ENGINE_DIR = path.resolve(SCRIPTS_DIR, "..", "..", "..");
  const ROOT = path.resolve(ENGINE_DIR, "..", "..");

  const REPORT_DIR = path.join(ROOT, "test-output", "self-examination-soft");
  const CONSENSUS_OUTPUT = path.join(ROOT, "test-output", "self-examination", "consensus-fix-list.md");
  const DB_DIR = path.join(ROOT, ".cortex");

  // 确保输出目录存在
  const outDir = path.dirname(CONSENSUS_OUTPUT);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  🧪 软约束共识圆桌 · 独立运行                      ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  报告目录: ${REPORT_DIR}`);
  console.log(`  共识输出: ${CONSENSUS_OUTPUT}`);
  console.log(`  模型: ${CHAT_MODEL}\n`);

  // ── 初始化 LLM ──
  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    reasonerModel: CHAT_MODEL,
    reasoningEffort: REASONING_EFFORT,
  });
  adapter.setCacheEnabled(true);

  // ── 1. 读取审视报告，构建种子记忆 ──
  const seedMemories: SeedMemory[] = [];

  const agentReportMap: Record<string, { key: string; label: string; emoji: string; agentType: string }> = {
    keqing: { key: "keqing", label: "刻晴", emoji: "⚡", agentType: "review" },
    albedo: { key: "albedo", label: "阿贝多", emoji: "⚗️", agentType: "code" },
    nahida: { key: "nahida", label: "纳西妲", emoji: "🌿", agentType: "analysis" },
    ningguang: { key: "ningguang", label: "凝光", emoji: "💎", agentType: "doc-govern" },
    mona: { key: "mona", label: "莫娜", emoji: "🔮", agentType: "loop" },
    amber: { key: "amber", label: "安柏", emoji: "🐰", agentType: "inspector" },
    beidou: { key: "beidou", label: "北斗", emoji: "⚓", agentType: "ops" },
    kuki: { key: "kuki", label: "久岐忍", emoji: "😈", agentType: "api" },
    alhaitham: { key: "alhaitham", label: "艾尔海森", emoji: "📚", agentType: "data" },
  };

  if (fs.existsSync(REPORT_DIR)) {
    const files = fs.readdirSync(REPORT_DIR);
    for (const [key, info] of Object.entries(agentReportMap)) {
      const reportFile = files.find(
        (f) => f.includes(key) && f.endsWith(".md") && !f.includes("summary") && !f.includes("roundtable")
      );
      if (!reportFile) {
        console.log(`  ⚠️ 未找到 ${info.emoji}${info.label} 的审视报告，跳过`);
        continue;
      }
      const reportPath = path.join(REPORT_DIR, reportFile);
      try {
        const rawContent = fs.readFileSync(reportPath, "utf-8");
        // 取前 4000 字符作为摘要（更多上下文，帮助 Agent 理解核心发现）
        const summary = rawContent.slice(0, 4000) + (rawContent.length > 4000 ? `...(截断，全文 ${rawContent.length} 字符)` : "");
        seedMemories.push({
          memoryType: MemoryType.Knowledge,
          content: { reportSummary: summary, sourceFile: reportFile },
          summary: `[审视报告:${info.emoji}${info.label}] ${reportFile} (${rawContent.length} 字符) —— 该 Agent 的软约束自由探索报告，详细记录了发现的具体问题、代码位置和严重程度评估`,
          agentType: info.agentType as AgentType,
          creatorId: "system",
          weight: 7,
        });
        console.log(`  📄 ${info.emoji}${info.label}: ${reportFile} → 种子记忆 (${rawContent.length} 字符)`);
      } catch (e) {
        console.log(`  ⚠️ ${info.emoji}${info.label} 报告读取失败: ${String(e)}`);
      }
    }

    // 额外注入：根因归簇分析报告
    const rootCauseFile = files.find((f) => f.includes("root-cause-cluster-analysis") && f.endsWith(".md"));
    if (rootCauseFile) {
      const rcaPath = path.join(REPORT_DIR, rootCauseFile);
      try {
        const rcaContent = fs.readFileSync(rcaPath, "utf-8");
        const rcaSummary = rcaContent.slice(0, 6000) + (rcaContent.length > 6000 ? `...(截断，全文 ${rcaContent.length} 字符)` : "");
        seedMemories.push({
          memoryType: MemoryType.Knowledge,
          content: { reportSummary: rcaSummary, sourceFile: rootCauseFile },
          summary: `[根因归簇分析报告] ${rootCauseFile} (${rcaContent.length} 字符) —— AI 归因引擎将 206+ 项发现跨报告去重归为 6 个根因簇`,
          agentType: "analysis" as AgentType,
          creatorId: "system",
          weight: 9,
        });
        console.log(`  📄 🔬根因归簇分析: ${rootCauseFile} → 种子记忆 (${rcaContent.length} 字符)`);
      } catch { /* skip */ }
    }

    // 额外注入：钟离战略评估报告
    const zhongliFile = files.find((f) => f.includes("zhongli-strategy-assessment") && f.endsWith(".md"));
    if (zhongliFile) {
      const zlPath = path.join(REPORT_DIR, zhongliFile);
      try {
        const zlContent = fs.readFileSync(zlPath, "utf-8");
        seedMemories.push({
          memoryType: MemoryType.Knowledge,
          content: { reportSummary: zlContent, sourceFile: zhongliFile },
          summary: `[钟离战略评估] ${zhongliFile} (${zlContent.length} 字符) —— 架构方向评估、契约完整性、阶段跃迁判定、磨损预警`,
          agentType: "strategist" as AgentType,
          creatorId: "system",
          weight: 8,
        });
        console.log(`  📄 🗿钟离战略评估: ${zhongliFile} → 种子记忆 (${zlContent.length} 字符)`);
      } catch { /* skip */ }
    }
  }

  console.log(`\n  🌱 共 ${seedMemories.length} 条种子记忆注入圆桌 MemoryStore\n`);

  // ── 2. 运行硬约束共识圆桌 ──
  console.log("🟢 硬约束共识圆桌启动...");
  console.log("  入席者: 刻晴 阿贝多 纳西妲 凝光 莫娜 安柏 北斗 久岐忍 艾尔海森 宵宫 甘雨 托马 钟离");
  console.log("  制度: 三轮 · 每轮 5-7 次发言 · 凝光收束签署 · 产出共识修复清单\n");

  try {
    await runMeeting(
      SOFT_CONSENSUS_ROUNDTABLE,
      adapter,
      CHAT_MODEL,
      DB_DIR,
      CONSENSUS_OUTPUT,
      seedMemories,
    );
    console.log(`\n  ✅ 共识修复清单已生成: ${CONSENSUS_OUTPUT}`);
    console.log(`  💡 下一轮运行硬约束验证时，将自动读取此清单。\n`);
  } catch (e) {
    console.error(`\n  ❌ 共识圆桌失败: ${String(e).slice(0, 500)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("软约束共识圆桌异常终止", err);
  process.exit(1);
});
