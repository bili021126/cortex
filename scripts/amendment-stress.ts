/**
 * 修宪管线压力测试 — 凝光读宪法→写提案→昔涟评判→写入宪法 全链路
 *
 * 测试维度:
 *   T1: 单元测试 — evaluateAmendment 边界与非法输入
 *   T2: Agent 生成提案 — MetaAgent→DocGovernAgent 读宪法写提案 JSON
 *   T3: 昔涟评判 — 对 T2 产物逐项 evaluateAmendment
 *   T4: 写入宪法 — applyAmendment 端到端 (自动备份)
 *   T5: 跨包协作 — data barrel 补全 (FIND-040) 多 Agent 协同
 *   T6: 圆桌验证 — 全员归因圆桌压测
 *
 * 用法: npx tsx scripts/amendment-stress.ts
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { bootstrapEngine } from "@cortex/engine";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "@cortex/platform";
import {
  evaluateAmendment,
  applyAmendment,
  loadPendingProposals,
  saveProposal,
  judgeProposals,
} from "@cortex/governance";
import type { AmendmentProposal } from "@cortex/shared";

// ════════════════════════════════════════════════════════
// §0 准备
// ════════════════════════════════════════════════════════
(function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) { console.error("缺少 .env"); process.exit(1); }
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.trim().match(/^([^=]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
})();

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "test-output", "amendment-stress");
fs.mkdirSync(OUTPUT, { recursive: true });

const CONSTITUTION_DIR = path.join(ROOT, "docs", "constitution");
const CONSTITUTION_PATH = path.join(CONSTITUTION_DIR, "Cortex 概念顶层设计 v2.5.27.md");
const BACKUP_DIR = path.join(CONSTITUTION_DIR, "archive");
const AMENDMENTS_DIR = path.join(ROOT, "docs", "amendments");
fs.mkdirSync(AMENDMENTS_DIR, { recursive: true });

const VERDICT: string[] = [];
function $(label: string, msg: string, ok: boolean) {
  const m = ok ? "✅" : "❌";
  console.log(`${m} [${label}] ${msg}`);
  VERDICT.push(`${m} [${label}] ${msg}`);
}
function H(title: string) {
  console.log(`\n${"=".repeat(60)}\n  ${title}\n${"=".repeat(60)}`);
}

function readConstitution(): string {
  return fs.readFileSync(CONSTITUTION_PATH, "utf-8");
}

// ════════════════════════════════════════════════════════
// T1: evaluateAmendment 单元边界测试
// ════════════════════════════════════════════════════════
H("T1: evaluateAmendment 边界测试");

const constitution = readConstitution();
const currentVersion = constitution.match(/\*\*版本\*\*[：:]\s*(v[\d.]+)/)?.[1] ?? "unknown";
const nextVersion = "v99.99.99"; // 安全大版本号，只用于测试不写入

// 合法提案 —— 修正 FIND-013 §14 Core-1 Agent 数量
const validProposal: AmendmentProposal = {
  id: `STRESS-T1-${Date.now()}`,
  version: nextVersion,
  section: "§14",
  category: "modify",
  summary: "修正 Core-1 阶段 Agent 数量声明：10→13，与 §5.1 对齐",
  rationale: "昔涟共识修复清单 FIND-013：§14 Core-1 行写「10 Agent」，实际已扩展至 13 种（算上 ButlerAgent 和审视参与者）。此为版本漂移修复，不涉及原则变更。",
  before: "| **Core-1** | Engine 重构 + 10 Agent + MemoryStore + Scheduler + PipelineObserver + SafeErrorReporter + SkillRegistry + SkillExecutor + better-sqlite3 + FTS5 全文索引 + embedding 384d 语义向量（170+ 测试全通过，自审视 7 Agent 并行验证通过，P0 全部闭合） |",
  after: "| **Core-1** | Engine 重构 + 13 Agent + MemoryStore + Scheduler + PipelineObserver + SafeErrorReporter + SkillRegistry + SkillExecutor + better-sqlite3 + FTS5 全文索引 + embedding 384d 语义向量（170+ 测试全通过，自审视 7 Agent 并行验证通过，P0 全部闭合） |",
  impact: { principles: [], crossReferences: ["§5.1", "§1"], agents: [], breaking: false },
  source: { agent: "凝光", trace: "amendment-stress T1" },
  status: "pending_judgment",
};

const result = evaluateAmendment(validProposal, constitution);
$("T1.1", `合法提案 verdict=${result.verdict}`, result.verdict === "APPROVED");
$("T1.2", "6 项检查全部通过", result.checks.every(c => c.passed));
for (const c of result.checks) {
  console.log(`     ${c.passed ? "✅" : "❌"} ${c.name}`);
}

// 版本号倒退
const badVersion: AmendmentProposal = {
  ...validProposal,
  id: "STRESS-T1-BADVER",
  version: "v0.0.1",
};
const rBadVer = evaluateAmendment(badVersion, constitution);
const vcCheck = rBadVer.checks.find(c => c.id === "version-continuity")!;
$("T1.3", `版本倒退 → ${vcCheck.passed ? "通过(错!)" : "未通过"}`, !vcCheck.passed);

// before 伪造
const fakeBefore: AmendmentProposal = {
  ...validProposal,
  id: "STRESS-T1-FAKE",
  before: "这段文字在宪法中绝对不存在 XYZ123",
};
const rFake = evaluateAmendment(fakeBefore, constitution);
const scCheck = rFake.checks.find(c => c.id === "structural-consistency")!;
$("T1.4", `before 伪造 → ${scCheck.passed ? "通过(错!)" : "阻塞"}`, !scCheck.passed && rFake.verdict === "BLOCKED");

// 触及不可变原则
const immutableProposal: AmendmentProposal = {
  ...validProposal,
  id: "STRESS-T1-IMMUTABLE",
  section: "原则一",
  impact: { principles: ["原则一"], crossReferences: [], agents: [], breaking: true },
};
const rImm = evaluateAmendment(immutableProposal, constitution);
$("T1.5", `触及不可变原则 → ${rImm.verdict}`, rImm.verdict === "BLOCKED");

// 空 after
const emptyAfter: AmendmentProposal = {
  ...validProposal,
  id: "STRESS-T1-EMPTY",
  after: "",
};
const rEmpty = evaluateAmendment(emptyAfter, constitution);
const fmtCheck = rEmpty.checks.find(c => c.id === "format-consistency")!;
$("T1.6", "空 after → 格式一致性告警", !fmtCheck.passed);

// 交叉引用伪造
const fakeRef: AmendmentProposal = {
  ...validProposal,
  id: "STRESS-T1-FAKEREF",
  impact: { principles: [], crossReferences: ["§99.不存在"], agents: [], breaking: false },
};
const rFakeRef = evaluateAmendment(fakeRef, constitution);
const crCheck = rFakeRef.checks.find(c => c.id === "cross-reference-integrity")!;
$("T1.7", `伪造交叉引用 → ${crCheck.passed ? "通过(错!)" : "阻塞"}`, !crCheck.passed && rFakeRef.verdict === "BLOCKED");

// 过短 rationale
const shortRationale: AmendmentProposal = {
  ...validProposal,
  id: "STRESS-T1-SHORT",
  rationale: "修",
};
const rShort = evaluateAmendment(shortRationale, constitution);
$("T1.8", "过短 rationale → NEEDS_CLARIFICATION", rShort.verdict === "NEEDS_CLARIFICATION");

$("T1.9", `加权总分计算正常 (${result.weightedScore.toFixed(2)})`, result.weightedScore > 0);

// ════════════════════════════════════════════════════════
// T2: Agent 生成修宪提案 — 逼凝光读宪法写 JSON
// ════════════════════════════════════════════════════════
H("T2: MetaAgent→DocGovernAgent 生成修宪提案");

const API_KEY = process.env.DEEPSEEK_API_KEY!;
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-v4-flash";
const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? CHAT_MODEL;

const chatAdapter = new LlmAdapter({ apiKey: API_KEY, baseUrl: BASE_URL, chatModel: CHAT_MODEL, reasonerModel: REASONER_MODEL });
chatAdapter.setCacheEnabled(true);
const reasonerAdapter = CHAT_MODEL === REASONER_MODEL ? chatAdapter
  : new LlmAdapter({ apiKey: API_KEY, baseUrl: BASE_URL, chatModel: REASONER_MODEL, reasonerModel: REASONER_MODEL });

const llms = new Map<string, LlmAdapter>();
llms.set("DEEPSEEK_CHAT", chatAdapter);
llms.set("DEEPSEEK_REASONER", reasonerAdapter);

const toolkit = new Toolkit();
const dbPath = path.join(ROOT, ".cortex", "memory-amendment-stress.db");
try { fs.unlinkSync(dbPath); } catch {}
try { fs.unlinkSync(dbPath + "-wal"); } catch {}
try { fs.unlinkSync(dbPath + "-shm"); } catch {}

const engine = await bootstrapEngine(ROOT, { llms, toolkit, dbPath });
engine.gate.bypassAll(); // 压测模式绕过确认门

// 宪法精简注入（避免 Agent 上下文爆炸）
const constitutionSummary = [
  `# 宪法摘要 —— 凝光请精读以下关键条款`,
  ``,
  `## FIND-013: §14 Core-1 行写「10 Agent」，实际 §5.1 有 13 种`,
  `原文: "| **Core-1** | Engine 重构 + 10 Agent + MemoryStore + ..."`,
  `修改: "10 Agent" → "13 Agent"`,
  ``,
  `## FIND-010/014: §1 写「14 种 Agent」，§5 标题写「13 种执行单元」`,
  `§1 原文: "以 14 种 Agent 为执行单元" → 昔涟不是 Agent，应改为 13`,
  `§5 标题原文: "## 五、Agent 池——13 种执行单元" → 确认正确`,
  ``,
 `## 输出要求`,
  `为以上两项各生成一个 AmendmentProposal JSON，写入:`,
  `1. ${path.join(AMENDMENTS_DIR, "stress-find013.json")}`,
  `2. ${path.join(AMENDMENTS_DIR, "stress-find010.json")}`,
  ``,
  `JSON 格式:`,
  `{`,
  `  "id": "STRESS-FIND-XXX",`,
  `  "version": "${nextVersion}",`,
  `  "section": "§14",`,
  `  "category": "modify",`,
  `  "summary": "一句话",`,
  `  "rationale": "充分理由 (≥50字)",`,
  `  "before": "宪法原文精确片段",`,
  `  "after": "修改后文本",`,
  `  "impact": { "principles": [], "crossReferences": ["§5.1"], "agents": [], "breaking": false },`,
  `  "source": { "agent": "凝光", "trace": "amendment-stress T2" },`,
  `  "status": "pending_judgment"`,
  `}`,
  ``,
  `⚠️ version 必须严格为 "${nextVersion}"，不可写成当前版本号！`,
  `⚠️ before 字段必须从宪法逐字复制！`,
  `⚠️ crossReferences 只写节号（如 "§5.1", "§1"），不要加描述文字！`,
].join("\n");

const constitutionSnippet = readConstitution()
  .split("\n")
  .filter(l => {
    const ll = l.trim();
    return ll.includes("Core-1") || ll.includes("14 种") || ll.includes("13 种") ||
           ll.startsWith("## 一、") || ll.startsWith("## 五、") || ll.startsWith("## 十四、") ||
           ll.includes("执行单元") || ll.includes("Agent") && ll.includes("为执行");
  })
  .slice(0, 40)
  .join("\n");

const t2NodeId = `t2-amend-${Date.now()}`;
engine.board.addNode({
  id: t2NodeId, type: "doc-govern", tags: ["doc-govern"] as any,
  needsMultiPerspective: false, status: "pending" as const, claimedBy: [],
  payload: [
    constitutionSummary,
    "",
    "## 宪法关键片段（仅供参考，提案 before 字段需用 read_file 读原文）",
    "```",
    constitutionSnippet.slice(0, 3000),
    "```",
    "",
    "用 read_file 读取宪法原文获取精确 before 文本，然后 write_file 写入两个提案 JSON 到 docs/amendments/ 目录。",
  ].join("\n"),
  results: [], createdAt: Date.now(),
});

$("T2.1", "凝光任务节点已注册", true);

const t2Report = await engine.scheduler.executeAll();
const t2Node = engine.board.getNode(t2NodeId);
$("T2.2", `凝光执行: status=${t2Node?.status}`, t2Node?.status === "done");

// 检查提案文件是否生成
const p013Path = path.join(AMENDMENTS_DIR, "stress-find013.json");
const p010Path = path.join(AMENDMENTS_DIR, "stress-find010.json");
const hasP013 = fs.existsSync(p013Path);
const hasP010 = fs.existsSync(p010Path);
$("T2.3", `FIND-013 提案: ${hasP013 ? "已生成" : "未生成"}`, hasP013);
$("T2.4", `FIND-010 提案: ${hasP010 ? "已生成" : "未生成"}`, hasP010);

let p013Proposal: AmendmentProposal | null = null;
let p010Proposal: AmendmentProposal | null = null;

if (hasP013) {
  try {
    const raw = JSON.parse(fs.readFileSync(p013Path, "utf-8"));
    // Agent 可能输出带 markdown 包裹的 JSON
    const json = typeof raw === "string" ? JSON.parse(raw) : raw;
    p013Proposal = json as AmendmentProposal;
    $("T2.5", `提案结构: id=${p013Proposal.id} section=${p013Proposal.section}`, !!p013Proposal.id);
  } catch (e: any) {
    $(`T2.5`, `JSON 解析失败: ${e.message}`, false);
  }
}

if (hasP010) {
  try {
    const raw = JSON.parse(fs.readFileSync(p010Path, "utf-8"));
    const json = typeof raw === "string" ? JSON.parse(raw) : raw;
    p010Proposal = json as AmendmentProposal;
    $("T2.6", `提案结构: id=${p010Proposal.id} section=${p010Proposal.section}`, !!p010Proposal.id);
  } catch (e: any) {
    $(`T2.6`, `JSON 解析失败: ${e.message}`, false);
  }
}

// ════════════════════════════════════════════════════════
// T3: 昔涟评判 — evaluateAmendment 压测
// ════════════════════════════════════════════════════════
H("T3: 昔涟评判 — evaluateAmendment");

// 评判手动构造的合法提案（确定性验证）
const j1 = evaluateAmendment(validProposal, constitution);
$("T3.1", `合法提案 (APPROVED): ${j1.verdict}`, j1.verdict === "APPROVED");

// 评判 Agent 生成的提案
if (p013Proposal) {
  try {
    // 确保必要字段存在
    const p: AmendmentProposal = {
      ...p013Proposal,
      status: "pending_judgment",
      // 如果 Agent 产出缺少字段，补默认值
      version: p013Proposal.version || nextVersion,
      impact: p013Proposal.impact || { principles: [], crossReferences: [], agents: [], breaking: false },
      source: p013Proposal.source || { agent: "凝光", trace: "amendment-stress T3" },
    };
    const j013 = evaluateAmendment(p, constitution);
    $(`T3.2`, `Agent 提案 FIND-013: ${j013.verdict} (score=${j013.weightedScore.toFixed(2)})`,
      j013.verdict !== "BLOCKED");
    for (const c of j013.checks) {
      console.log(`     ${c.passed ? "✅" : "❌"} ${c.name}: ${c.detail.slice(0, 80)}`);
    }
    if (j013.blocking.length > 0) {
      for (const b of j013.blocking) console.log(`     🚫 BLOCKED: ${b}`);
    }
  } catch (e: any) {
    $(`T3.2`, `评判异常: ${e.message}`, false);
  }
} else {
  $("T3.2", "无 FIND-013 提案，跳过", false);
}

if (p010Proposal) {
  try {
    const p: AmendmentProposal = {
      ...p010Proposal,
      status: "pending_judgment",
      version: p010Proposal.version || nextVersion,
      impact: p010Proposal.impact || { principles: [], crossReferences: [], agents: [], breaking: false },
      source: p010Proposal.source || { agent: "凝光", trace: "amendment-stress T3" },
    };
    const j010 = evaluateAmendment(p, constitution);
    $(`T3.3`, `Agent 提案 FIND-010: ${j010.verdict} (score=${j010.weightedScore.toFixed(2)})`,
      j010.verdict !== "BLOCKED");
    for (const c of j010.checks) {
      console.log(`     ${c.passed ? "✅" : "❌"} ${c.name}: ${c.detail.slice(0, 80)}`);
    }
    if (j010.blocking.length > 0) {
      for (const b of j010.blocking) console.log(`     🚫 BLOCKED: ${b}`);
    }
  } catch (e: any) {
    $(`T3.3`, `评判异常: ${e.message}`, false);
  }
} else {
  $("T3.3", "无 FIND-010 提案，跳过", false);
}

// ════════════════════════════════════════════════════════
// T4: applyAmendment — 写入宪法 (备份后)
// ════════════════════════════════════════════════════════
H("T4: applyAmendment 写入宪法");

// 备份当前宪法
const backupPath = path.join(BACKUP_DIR, `Cortex v2.5.27-pre-amendment-stress-${Date.now()}.md`);
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.copyFileSync(CONSTITUTION_PATH, backupPath);
$("T4.1", `宪法备份: ${path.basename(backupPath)}`, fs.existsSync(backupPath));

// 应用合法提案
const versionedPath = path.join(CONSTITUTION_DIR, `Cortex 概念顶层设计 ${nextVersion}.md`);
const applyResult = applyAmendment(validProposal, CONSTITUTION_PATH);
$("T4.2", `写入成功: ${applyResult.success}`, applyResult.success);

if (applyResult.success) {
  // applyAmendment 会将原文件重命名为版本号文件，所以要用版本号路径读取
  const newConstitutionPath = fs.existsSync(versionedPath) ? versionedPath : CONSTITUTION_PATH;
  const newContent = fs.readFileSync(newConstitutionPath, "utf-8");
  $("T4.3", "宪法包含 '13 Agent'", newContent.includes("13 Agent"));
  $("T4.4", "宪法不包含 '10 Agent + MemoryStore'", !newContent.includes("10 Agent + MemoryStore"));

  // 恢复宪法（压测不应留下脏数据）—— 先删版本号文件，再从备份恢复
  if (fs.existsSync(versionedPath)) {
    try { fs.unlinkSync(versionedPath); } catch {}
  }
  fs.copyFileSync(backupPath, CONSTITUTION_PATH);
  $("T4.5", `宪法已从备份恢复`, fs.readFileSync(CONSTITUTION_PATH, "utf-8").includes("10 Agent + MemoryStore"));
} else {
  $("T4.3", `写入失败: ${applyResult.error}`, false);
}

// ════════════════════════════════════════════════════════
// T5: 跨包 Agent 协作 — data barrel 补全 (FIND-040)
// ════════════════════════════════════════════════════════
H("T5: 跨包 Agent 协作 — data barrel 补全");

const t5NodeId = `t5-cross-${Date.now()}`;
engine.board.addNode({
  id: t5NodeId, type: "analysis", tags: ["analysis", "api"] as any,
  needsMultiPerspective: true, // 多 Agent 并行
  status: "pending" as const, claimedBy: [],
  payload: [
    "# 跨包协修任务：data 包 barrel 导出补全",
    "",
    "## 背景",
    "昔涟共识修复清单 FIND-040：@cortex/data 包的 barrel 导出不完整，缺少 TaskRepository 和 TaskFilter。",
    "这会导致 Core-2 StrategistAgent 消费 Task 数据结构时遭遇 `Cannot find module`。",
    "",
    "## 步骤",
    "1. 用 read_file 读取 packages/data/src/index.ts (barrel)",
    "2. 用 search_code 搜索 packages/data/src/ 中所有的 export class/interface/function",
    "3. 对比 barrel 与源码，找出缺失的导出",
    "4. 如果缺少 TaskRepository 和 TaskFilter，用 search_replace 补全 barrel 导出",
    "5. 用 run_shell 运行 `cd packages/data && npx tsc -p tsconfig.json` 验证编译通过",
    "",
    "## 约束",
    "仅修改 barrel 导出行，不改源码逻辑。保持现有格式一致。",
  ].join("\n"),
  results: [], createdAt: Date.now(),
});

$("T5.1", "跨包任务节点已注册 (needsMultiPerspective=true)", true);

const t5Report = await engine.scheduler.executeAll();
const t5Node = engine.board.getNode(t5NodeId);
$("T5.2", `跨包执行: ${t5Report.completed}✅ ${t5Report.failed}❌`, t5Report.failed === 0);

// 检查 data barrel 当前状态
const dataBarrelPath = path.join(ROOT, "packages", "data", "src", "index.ts");
if (fs.existsSync(dataBarrelPath)) {
  const barrelContent = fs.readFileSync(dataBarrelPath, "utf-8");
  const hasRepo = barrelContent.includes("TaskRepository");
  const hasFilter = barrelContent.includes("TaskFilter");
  $("T5.3", `data barrel 包含 TaskRepository: ${hasRepo}`, hasRepo);
  $("T5.4", `data barrel 包含 TaskFilter: ${hasFilter}`, hasFilter);
}

// ════════════════════════════════════════════════════════
// T6: 圆桌验证 — 全员归因
// ════════════════════════════════════════════════════════
H("T6: 圆桌验证 — 全员归因");

// 简洁版：只让凝光+纳西妲互审
const t6NodeId = `t6-roundtable-${Date.now()}`;
engine.board.addNode({
  id: t6NodeId, type: "doc-govern", tags: ["doc-govern"] as any,
  needsMultiPerspective: false, status: "pending" as const, claimedBy: [],
  payload: [
    "# 归因圆桌：修宪压测结果总结",
    "",
    "## 压测结果摘要",
    ...VERDICT.slice(0, 20),
    "",
    "## 任务",
    "简短发言 (≤300字)：本次修宪压测中，凝光提案→昔涟评判→写入宪法全链路是否健康？",
    "哪一步是瓶颈？哪一步会崩？",
    `写入 ${path.join(OUTPUT, "roundtable-amendment-stress.md")}`,
  ].join("\n"),
  results: [], createdAt: Date.now(),
});

$("T6.1", "圆桌任务节点已注册", true);

const t6Report = await engine.scheduler.executeAll();
const t6Node = engine.board.getNode(t6NodeId);
$("T6.2", `圆桌执行: status=${t6Node?.status}`, t6Node?.status === "done");

const rtOutput = path.join(OUTPUT, "roundtable-amendment-stress.md");
$("T6.3", `圆桌产出: ${fs.existsSync(rtOutput)}`, fs.existsSync(rtOutput));
if (fs.existsSync(rtOutput)) {
  const rtContent = fs.readFileSync(rtOutput, "utf-8");
  $("T6.4", `圆桌发言: ${rtContent.length} 字符 (>50)`, rtContent.length > 50);
}

// ════════════════════════════════════════════════════════
// 汇总
// ════════════════════════════════════════════════════════
H("汇总");

const pass = VERDICT.filter(v => v.startsWith("✅")).length;
const fail = VERDICT.filter(v => v.startsWith("❌")).length;
console.log(`\n通过: ${pass} | 失败: ${fail} | 总计: ${VERDICT.length}\n`);

// 写报告
const reportLines = [
  `# 修宪管线压力测试报告`,
  `日期: ${new Date().toISOString()}`,
  `宪法版本: ${currentVersion}`,
  ``,
  `通过: ${pass} | 失败: ${fail} | 总计: ${VERDICT.length}`,
  ``,
  `## 全部结果`,
  ...VERDICT,
  ``,
  `## 管线摘要`,
  `- T1: evaluateAmendment 边界测试`,
  `- T2: MetaAgent→DocGovernAgent 生成提案`,
  `- T3: 昔涟评判 Agent 产物`,
  `- T4: applyAmendment 写入+恢复`,
  `- T5: 跨包 Agent 协作`,
  `- T6: 圆桌验证`,
];

if (fail > 0) {
  reportLines.push(``, `## ⚠️ 失败项`, ...VERDICT.filter(v => v.startsWith("❌")).map(v => `- ${v}`));
}

const reportMd = reportLines.join("\n");
fs.writeFileSync(path.join(OUTPUT, "report.md"), reportMd, "utf-8");
console.log(`报告: test-output/amendment-stress/report.md`);

engine.gate?.dispose();
engine.cliAdapter?.close();
process.exit(fail > 0 ? 1 : 0);
