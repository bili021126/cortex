/**
 * 独立圆桌 + 交叉验证脚本 —— v2
 *
 * 流程：加载报告 → 交叉验证（代码实证）→ 压缩注入 → 圆桌共识
 *
 * 用法: npx tsx packages/engine/tests/manual/scripts/run-roundtable-standalone.ts
 * 前提: test-output/self-examination-soft/ 下已有 Agent 审视报告
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { LlmAdapter } from "@cortex/llm";
import { compressForRoundtable } from "@cortex/platform";
import { runMeeting, SOFT_CONSENSUS_ROUNDTABLE, Persona } from "../config/roundtable-config";
import { resolveLlmConfig } from "../config/llm-defaults";
import { AgentType } from "@cortex/shared";
import cortexConfig from "../../../../../cortex-agents.json" assert { type: "json" };

// ── 加载 .env ──
function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
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
loadEnv();

// ── 路径推导 ──
const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = path.dirname(__filename);
const ENGINE_DIR = path.resolve(SCRIPTS_DIR, "..", "..", "..");
const ROOT = path.resolve(ENGINE_DIR, "..", "..");
const OUTPUT_DIR = path.join(ROOT, cortexConfig.selfExamination.outputDir.soft);
const CONSENSUS_OUTPUT = path.join(ROOT, "test-output", "self-examination-soft", "consensus-fix-list.md");
const DB_DIR = path.join(ROOT, ".cortex");

console.log(`📂 报告目录: ${OUTPUT_DIR}`);
console.log(`📝 共识输出: ${CONSENSUS_OUTPUT}\n`);

// ── 初始化 LLM ──
const llmCfg = resolveLlmConfig({ chatModel: "deepseek-v4-flash" });
const CHAT_MODEL = llmCfg.chatModel;
console.log(`  模型: ${CHAT_MODEL}`);

const adapter = new LlmAdapter({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseUrl: llmCfg.baseUrl,
  chatModel: CHAT_MODEL});
adapter.setCacheEnabled(true);

// ═══════════════════════════════════════════════
// 额外 Persona：昔涟、甘雨、钟离
// ═══════════════════════════════════════════════
const EXTRA_PERSONAS: Persona[] = [
  {
    type: AgentType.Meta,
    emoji: "🍀",
    name: "昔涟",
    title: "终审守望者",
    systemPrompt: fs.readFileSync(path.join(ROOT, "prompts/cyrene/roundtable.md"), "utf-8")},
  {
    type: AgentType.Meta,
    emoji: "📋",
    name: "甘雨",
    title: "全局上下文守护者",
    systemPrompt: fs.readFileSync(path.join(ROOT, "prompts/ganyu/roundtable.md"), "utf-8")},
  {
    type: AgentType.Strategist,
    emoji: "☄️",
    name: "钟离",
    title: "战略顾问",
    systemPrompt: fs.readFileSync(path.join(ROOT, "prompts/zhongli/roundtable.md"), "utf-8")},
];

// ═══════════════════════════════════════════════
// Phase 1: 收集审视报告
// ═══════════════════════════════════════════════
if (!fs.existsSync(OUTPUT_DIR)) {
  console.error(`❌ 报告目录不存在: ${OUTPUT_DIR}`);
  process.exit(1);
}

const files = fs.readdirSync(OUTPUT_DIR);
const consensusKeys = cortexConfig.selfExamination.consensusAgents as string[];
const agentReportMap: Record<string, { key: string; label: string; emoji: string }> = {};

for (const k of consensusKeys) {
  const agent = (cortexConfig.agents as Record<string, { display?: { emoji: string; shortName: string } }>)[k];
  if (agent?.display) {
    agentReportMap[k] = { key: k, label: agent.display.shortName, emoji: agent.display.emoji };
  }
}

console.log(`   📋 目录下共 ${files.filter((f) => f.endsWith(".md")).length} 个 .md 文件`);

const reportInputs: Array<{ agentKey: string; label: string; emoji: string; content: string }> = [];

for (const [key, info] of Object.entries(agentReportMap)) {
  const candidates = files.filter(
    (f) => f.endsWith(".md") && !f.includes("summary") && !f.includes("roundtable")
  );
  let reportFile = candidates.find((f) => f.toLowerCase().startsWith(key.toLowerCase() + "-"));
  if (!reportFile) {
    reportFile = candidates.find((f) => f.toLowerCase().includes(key.toLowerCase()));
  }
  if (!reportFile) {
    console.log(`   ⚠️ 未找到 ${info.emoji}${info.label}(${key}) 的审视报告，跳过`);
    continue;
  }
  const reportPath = path.join(OUTPUT_DIR, reportFile);
  try {
    const rawContent = fs.readFileSync(reportPath, "utf-8");
    reportInputs.push({ agentKey: key, label: info.label, emoji: info.emoji, content: rawContent });
    console.log(`   📄 ${info.emoji}${info.label}: ${reportFile} (${rawContent.length} 字符)`);
  } catch (e) {
    console.log(`   ⚠️ ${info.emoji}${info.label} 报告读取失败`);
  }
}

if (reportInputs.length === 0) {
  console.error("❌ 没有找到任何审视报告");
  process.exit(1);
}

// ═══════════════════════════════════════════════
// Phase 2: 交叉验证（代码实证）
// ═══════════════════════════════════════════════
console.log(`\n🔍 Phase 2: 交叉验证——代码实证对比`);

// 从所有报告中提取文件引用，预读代码
const FILE_REF_RE = /(?:packages|engine|shared|cli|tools|data)\/[\w\/-]+\.ts/g;
const allRefs = new Set<string>();
for (const r of reportInputs) {
  const matches = r.content.match(FILE_REF_RE);
  if (matches) for (const m of matches) allRefs.add(m);
}

// 读取被引用最多的代码文件（最多 12 个，每个最多 3000 字符）
const CODE_SNIPPETS: Record<string, string> = {};
const MAX_FILES = 12;
const MAX_CHARS_PER_FILE = 3000;
let fileCount = 0;

for (const ref of allRefs) {
  if (fileCount >= MAX_FILES) break;
  const filePath = path.join(ROOT, ref);
  if (!fs.existsSync(filePath)) continue;
  try {
    const code = fs.readFileSync(filePath, "utf-8");
    CODE_SNIPPETS[ref] = code.length > MAX_CHARS_PER_FILE
      ? code.slice(0, MAX_CHARS_PER_FILE) + "\n// ...(截断)"
      : code;
    fileCount++;
    console.log(`   📖 预读代码: ${ref} (${CODE_SNIPPETS[ref].length} 字符)`);
  } catch {}
}

// 补充关键文件：之前圆桌假阳性的热点
const HOT_FILES = [
  "packages/engine/src/core/confirm-gate.ts",
  "packages/engine/src/memory/lifecycle.ts",
  "packages/engine/src/platform/file-lock-manager.ts",
  "packages/engine/src/platform/toolkit.ts",
  "packages/shared/src/doc-registry.ts",
];
for (const ref of HOT_FILES) {
  if (CODE_SNIPPETS[ref]) continue;
  const filePath = path.join(ROOT, ref);
  if (!fs.existsSync(filePath)) continue;
  const code = fs.readFileSync(filePath, "utf-8");
  CODE_SNIPPETS[ref] = code.length > MAX_CHARS_PER_FILE
    ? code.slice(0, MAX_CHARS_PER_FILE) + "\n// ...(截断)"
    : code;
  console.log(`   📖 预读热点: ${ref} (${CODE_SNIPPETS[ref].length} 字符)`);
}

// 构建代码证据块
const codeEvidenceBlock = Object.entries(CODE_SNIPPETS)
  .map(([f, code]) => `### ${f}\n\`\`\`typescript\n${code}\n\`\`\``)
  .join("\n\n");

console.log(`   🧬 预读 ${Object.keys(CODE_SNIPPETS).length} 个代码文件，共 ${codeEvidenceBlock.length} 字符\n`);

// 逐报告交叉验证
interface VerifiedFinding {
  agentLabel: string;
  claim: string;
  verdict: "✅" | "❌" | "⚠️";
  evidence: string;
}

const allVerifiedFindings: VerifiedFinding[] = [];

console.log("   🔍 逐报告交叉验证...");

const VERIFICATION_PROMPT = [
  "你是交叉验证员。你的唯一任务是：逐条阅读审视报告中的发现，将其与下方提供的实际代码进行对比。",
  "",
  "## 工作流程",
  "1. 阅读审视报告中的每一条发现",
  "2. 在下方实际代码中搜索相关证据",
  "3. 判定：✅ 代码证实 / ❌ 代码反驳 / ⚠️ 代码中找不到证据（标注原因）",
  "",
  "## 判定规则（事实优先）",
  "- 代码的实际内容 > 报告中的声明 > 你的任何记忆",
  "- 如果代码与报告矛盾，代码是对的，报告是错的——标 ❌",
  "- 代码中找不到相关证据——标 ⚠️ 并说明'报告声称 X，但代码中没有 Y'",
  "- 如果报告没有给出具体文件/行号但你能在代码中找到——标 ✅ 并附代码位置",
  "- **禁止凭记忆判断**——你的判断必须引用下方提供的实际代码",
  "",
  "## 输出格式",
  "",
  "逐条输出，格式：",
  "| 报告Agent | 发现摘要 | 判定 | 代码证据 |",
  "|---|---|---|---|",
  "| 刻晴 | ConfirmGate dispose 用 resolve(false) | ❌ | confirm-gate.ts:176 实际用 reject(ConfirmGateDisposedError) |",
  "",
].join("\n");

for (const r of reportInputs) {
  const MAX_REPORT_CTX = 5000;
  const truncatedReport = r.content.length > MAX_REPORT_CTX
    ? r.content.slice(0, MAX_REPORT_CTX) + "\n\n...(截断)"
    : r.content;

  const prompt = [
    VERIFICATION_PROMPT,
    "",
    `## ${r.emoji}${r.label} 的审视报告`,
    "",
    truncatedReport,
    "",
    "---",
    "## 实际代码（以下为代码库的真实内容，以此为准）",
    "",
    codeEvidenceBlock.slice(0, 8000),
  ].join("\n");

  process.stdout.write(`      ${r.emoji}${r.label}... `);
  try {
    const res = await adapter.chat(CHAT_MODEL, [
      { role: "system", content: "你是交叉验证员。只基于提供的实际代码做判断，不凭记忆。" },
      { role: "user", content: prompt },
    ]);
    const text = res.content ?? "";

    // 提取表格中的判定行
    const lines = text.split("\n");
    for (const line of lines) {
      const match = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([✅❌⚠️])\s*\|\s*(.+?)\s*\|/);
      if (match) {
        allVerifiedFindings.push({
          agentLabel: match[1].trim(),
          claim: match[2].trim(),
          verdict: match[3] as "✅" | "❌" | "⚠️",
          evidence: match[4].trim()});
      }
    }
    console.log(`✅ ${allVerifiedFindings.filter((f) => f.agentLabel === r.label).length} 条判定`);
  } catch (e) {
    console.log(`❌ ${String(e).slice(0, 80)}`);
  }
}

// 汇总交叉验证结果
const verifiedCount = allVerifiedFindings.filter((f) => f.verdict === "✅").length;
const falsifiedCount = allVerifiedFindings.filter((f) => f.verdict === "❌").length;
const unverifiedCount = allVerifiedFindings.filter((f) => f.verdict === "⚠️").length;

console.log(`\n   📊 交叉验证汇总: ✅${verifiedCount} ❌${falsifiedCount} ⚠️${unverifiedCount}`);

// 生成交叉验证摘要，注入圆桌 topic
let verificationSummary = "";
if (allVerifiedFindings.length > 0) {
  const falsifiedItems = allVerifiedFindings.filter((f) => f.verdict === "❌");
  const verifiedItems = allVerifiedFindings.filter((f) => f.verdict === "✅");

  verificationSummary = [
    "",
    "─── ⚠️ 交叉验证结果（代码实证——事实权重高于记忆）───",
    `代码查证率: ${verifiedCount + falsifiedCount}/${allVerifiedFindings.length} (${((verifiedCount + falsifiedCount) / Math.max(allVerifiedFindings.length, 1) * 100).toFixed(0)}%)`,
    "",
    ...(falsifiedItems.length > 0 ? [
      "## ❌ 被代码反驳的发现（以下声明与代码实际内容矛盾——圆桌中不得引用）",
      ...falsifiedItems.map((f) => `- [${f.agentLabel}] ${f.claim} → 实际: ${f.evidence}`),
      "",
    ] : []),
    ...(verifiedItems.length > 0 ? [
      "## ✅ 被代码证实的发现（可信——可作为圆桌讨论依据）",
      ...verifiedItems.slice(0, 15).map((f) => `- [${f.agentLabel}] ${f.claim} → 证实: ${f.evidence}`),
      "",
    ] : []),
    "## ⚠️ 未经验证的发现（代码中找不到证据——圆桌发言权重为 0，不得进入 P0/P1 清单）",
    `共 ${unverifiedCount} 条——讨论中如需引用，需标注「未经验证」`,
    "",
    "─── 以上为交叉验证结果，圆桌讨论中代码证据优先于记忆 ───",
  ].join("\n");
}

console.log(`   📝 交叉验证摘要: ${verificationSummary.length} 字符\n`);

// ═══════════════════════════════════════════════
// Phase 3: 压缩注入 + 圆桌
// ═══════════════════════════════════════════════
const { compressed, aggregateSummary } = compressForRoundtable(reportInputs, 16_000);

for (const c of compressed) {
  const ratio = ((1 - c.compressedLength / Math.max(c.rawLength, 1)) * 100).toFixed(0);
  console.log(`   📊 ${c.emoji}${c.label}: ${c.rawLength}→${c.compressedLength} 字符 (压缩 ${ratio}%)`);
}

// 注入 topic：报告摘要 + 交叉验证结果
const origTopic = SOFT_CONSENSUS_ROUNDTABLE.rounds[0].topic;
const enrichedTopic = origTopic
  + "\n\n─── 各 Agent 审视报告摘要（请优先阅读）───\n" + aggregateSummary
  + "\n" + verificationSummary;

SOFT_CONSENSUS_ROUNDTABLE.rounds[0].topic = enrichedTopic;

// 添加额外 persona 到圆桌
SOFT_CONSENSUS_ROUNDTABLE.personas.push(...EXTRA_PERSONAS);

// ── 运行圆桌 ──
const allLabels = [
  ...consensusKeys.map((k) => agentReportMap[k]?.label ?? k),
  ...EXTRA_PERSONAS.map((p) => p.name),
];
console.log(`🟢 启动软约束共识圆桌...`);
console.log(`   入席者: ${allLabels.join(" ")} (${SOFT_CONSENSUS_ROUNDTABLE.personas.length} 人)`);
console.log(`   制度: 单轮合并 · 每人 3-5 次发言 · 凝光收束签署 · 事实权重规则生效\n`);

try {
  await runMeeting(
    SOFT_CONSENSUS_ROUNDTABLE,
    adapter,
    CHAT_MODEL,
    DB_DIR,
    CONSENSUS_OUTPUT,
  );
  console.log(`\n✅ 共识修复清单: ${CONSENSUS_OUTPUT}`);
} catch (e) {
  console.error(`\n❌ 共识圆桌失败: ${String(e).slice(0, 300)}`);
  process.exit(1);
}
