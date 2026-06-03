/**
 * 软约束自审视 —— 五环治理驱动 7 阶段全流程
 *
 * Phase 0: 甘雨意图解析 → 动态生成任务（直接 LLM 调用）
 * Phase 1: 9 Agent 并发认领执行（单视角独立任务，覆盖全部闭环）
 * Phase 2: 交叉验证（4 对配对）
 * Phase 3: 发现矩阵汇总
 * Phase 4a: 全员归因圆桌（每个 Agent 独立发言 node，并行认领）
 * Phase 4b: 凝光宪法审计（直接 LLM 调用）
 * Phase 4c: 钟离战略评估 + 霜凝监理展望（独立 LLM 调用）
 * Phase 5: 昔涟优先级裁决 → 共识修复清单（P0/P1/P2，不签署）
 *
 * 用法: npx tsx scripts/self-exam-soft.ts
 * 前提: .env 已配置 DEEPSEEK_API_KEY, DEEPSEEK_CYRENE_KEY
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { bootstrapEngine, LlmAdapter, Toolkit } from "@cortex/engine";
import type { TaskNode } from "@cortex/shared";
import type { ExecutionReport } from "@cortex/shared";

// ════════════════════════════════════════════════════════
// §0 .env 加载
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
const OUTPUT = path.join(ROOT, "test-output", "self-examination-soft");
fs.mkdirSync(OUTPUT, { recursive: true });

// ════════════════════════════════════════════════════════
// §1 工具函数
// ════════════════════════════════════════════════════════

function readReport(name: string): string {
  const p = path.join(OUTPUT, name);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : `(文件缺失: ${name})`;
}

function makeNode(id: string, type: string, tags: string[], payload: string, multi = false): TaskNode {
  return {
    id, type, tags: tags as any, needsMultiPerspective: multi,
    status: "pending" as const, claimedBy: [],
    payload, results: [], createdAt: Date.now(),
  };
}

function addNodes(ns: TaskNode[]): void {
  for (const n of ns) engine.board.addNode(n);
}

function printPhaseResult(phase: string, result: ExecutionReport, start: number): void {
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  const failedList = engine.board.getAllNodes()
    .filter(n => n.status === "failed")
    .map(n => `  ❌ ${n.type}/${n.tags[0]}`);
  console.log(`\n${phase}: ${result.completed}✅ / ${result.failed}❌  ⏱ ${elapsed}s`);
  if (failedList.length > 0) console.log(failedList.join("\n"));
}

function listOutputs(): string[] {
  if (!fs.existsSync(OUTPUT)) return [];
  return fs.readdirSync(OUTPUT).filter(f => f.endsWith(".md"))
    .map(f => `  ${f} (${(fs.statSync(path.join(OUTPUT, f)).size / 1024).toFixed(1)}KB)`);
}

// ════════════════════════════════════════════════════════
// §2 引擎日志精简——只保留任务层事件
// ════════════════════════════════════════════════════════
const originalConsoleLog = console.log;

const TASK_EMOJIS = [
  "⚙️",   // 引擎就绪
  "💬",   // 昔涟发言
  "🔰",   // 甘雨意图
];

function isTaskLog(msg: string): boolean {
  // Phase 结果行
  if (msg.includes("Phase") || msg.includes("✅") || msg.includes("❌")) return true;
  // 产出统计
  if (msg.includes("产出") || msg.includes("文件") || msg.includes("共识修复清单")) return true;
  // 特定 emoji
  for (const e of TASK_EMOJIS) { if (msg.includes(e)) return true; }
  // 圆桌发言文件
  if (msg.includes("roundtable-") && msg.includes(".md")) return true;
  return false;
}

console.log = (...args: any[]) => {
  const msg = args.join(" ");
  if (isTaskLog(msg)) originalConsoleLog(...args);
};

// ════════════════════════════════════════════════════════
// §3 LLM 准备
// ════════════════════════════════════════════════════════
const API_KEY = process.env.DEEPSEEK_API_KEY!;
const CYRENE_KEY = process.env.DEEPSEEK_CYRENE_KEY ?? API_KEY;
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-v4-flash";
const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? CHAT_MODEL;

const chatAdapter = new LlmAdapter({ apiKey: API_KEY, baseUrl: BASE_URL, chatModel: CHAT_MODEL });
chatAdapter.setCacheEnabled(true);
const reasonerAdapter = CHAT_MODEL === REASONER_MODEL ? chatAdapter
  : new LlmAdapter({ apiKey: API_KEY, baseUrl: BASE_URL, chatModel: REASONER_MODEL });
const cyreneAdapter = CYRENE_KEY === API_KEY ? chatAdapter
  : new LlmAdapter({ apiKey: CYRENE_KEY, baseUrl: BASE_URL, chatModel: CHAT_MODEL });

const llms = new Map<string, LlmAdapter>();
llms.set("DEEPSEEK_CHAT", chatAdapter);
llms.set("DEEPSEEK_REASONER", reasonerAdapter);
llms.set("DEEPSEEK_CYRENE", cyreneAdapter);
const toolkit = new Toolkit();

// ════════════════════════════════════════════════════════
// §4 引擎启动
// ════════════════════════════════════════════════════════
console.log("⚙️  引擎就绪");
const dbPath = path.join(ROOT, ".cortex", "memory-self-exam.db");
try { fs.unlinkSync(dbPath); } catch {}
try { fs.unlinkSync(dbPath + "-wal"); } catch {}
try { fs.unlinkSync(dbPath + "-shm"); } catch {}

const engine = await bootstrapEngine(ROOT, { llms, toolkit, dbPath });

// ════════════════════════════════════════════════════════
// §5 Agent 类型与角色定义
// ════════════════════════════════════════════════════════
const AGENT_ROLES: Record<string, { name: string; domain: string }> = {
  code:      { name: "阿贝多",   domain: "构建/测试/类型检查/Lint 全链路健康" },
  review:    { name: "刻晴",     domain: "typecheck→build→test 三连绿灯，CI 脚本可执行" },
  ops:       { name: "北斗",     domain: "包依赖完整性、workspace 拓扑、构建产物一致性" },
  analysis:  { name: "纳西妲",   domain: "模块间依赖无循环，shared 协议完整，barrel 导出健全" },
  loop:      { name: "莫娜",     domain: "MemoryStore 生产→存储→检索→去重闭环；事件总线发布→订阅→投递" },
  inspector: { name: "安柏",     domain: "目录无孤儿文件、配置漂移检测、tsconfig references 一致性" },
  api:       { name: "久岐忍",   domain: "engine 公开 API barrel 导出完整性，外部 import 无断裂" },
  data:      { name: "艾尔海森", domain: "MemoryStore schema 完整性、读写一致性、迁移兼容性" },
  "doc-govern": { name: "凝光",  domain: "docs/ 治理文档框架完整可读，但仅做结构审计——宪法一致性检查由圆桌后的凝光独立审计完成" },
};

const AGENT_TYPES = Object.keys(AGENT_ROLES);

// ════════════════════════════════════════════════════════
// §6 Phase 0: 甘雨意图解析 → 动态生成任务
// ════════════════════════════════════════════════════════
const GANYU_SYSTEM = [
  "你是甘雨，Cortex 中书令。你的职责是战术规划——",
  "将高层意图解析为具体可执行的验证任务，拆解为任务节点并发布到 TaskBoard。",
  "",
  "## 角色定位",
  "- 你接收来自开拓者/昔涟的审视意图",
  "- 你了解 Cortex 全部工程闭环及其对应的 Agent 类型",
  "- 你产出的任务会被 9 个 Agent 认领执行",
  "",
  "## 可用的 Agent 类型及其专长领域",
  "- code（阿贝多）: 构建链路 tsc/pnpm build、测试链路 vitest、Lint eslint",
  "- review（刻晴）: typecheck→build→test 三连，CI 脚本可执行性",
  "- ops（北斗）: 包依赖、workspace 拓扑、构建产物",
  "- analysis（纳西妲）: 模块依赖方向、shared 协议完整性、循环引用检测",
  "- loop（莫娜）: MemoryStore 读写闭环、事件总线发布订阅、Skill 管线",
  "- inspector（安柏）: 孤儿文件、配置漂移、tsconfig references",
  "- api（久岐忍）: barrel 导出完整性、公开 API 断链检测",
  "- data（艾尔海森）: schema 完整性、读写一致性、迁移兼容",
  "- doc-govern（凝光）: 文档框架结构审计（宪法一致性由后续独立审计完成）",
  "",
  "## 输出格式",
  "为每个 Agent 类型生成一个任务条目，每个条目一行，格式：",
  "TYPE | 验证方向一句话 | 输出文件名",
  "",
  "TYPE 必须从上述列表中选取。每个 TYPE 只出现一次。",
  "验证方向应覆盖该 Agent 对应的全部闭环。",
  "输出文件名格式：{agent-lower}-review.md",
].join("\n");

const GANYU_INTENT = [
  "执行 Cortex 软约束自审视。覆盖全部工程闭环（治理修宪闭环除外），产出共识修复清单。",
  "需要验证的闭环包括但不限于：",
  "- 构建链路：tsc 编译→pnpm build 全包通过",
  "- 测试链路：vitest 全量无失败",
  "- 类型检查：tsc --noEmit 零错误",
  "- Lint 链路：eslint 零 error",
  "- 记忆管线：MemoryStore 生产→存储→检索→去重全链路",
  "- ReAct 调度：Scheduler→AgentPool→工具调用→write_file",
  "- Skill 管线：extract→execute→persist",
  "- 事件总线：publish→subscribe→deliver",
  "- API Barrel：公开符号导出完整性",
  "- 数据管线：schema→migration→compatibility",
  "- 依赖健康：无循环引用、全部声明",
  "- 配置漂移：tsconfig references、package.json exports",
  "- 文档框架：docs/ 目录结构完整可读",
  "",
  "请为每个 Agent 类型生成任务。",
].join("\n");

const p0Start = Date.now();
const ganyuResponse = await chatAdapter.chat(CHAT_MODEL, [
  { role: "system", content: GANYU_SYSTEM },
  { role: "user", content: GANYU_INTENT },
]);

// 解析甘雨输出
const ganyuText = ganyuResponse.content ?? "";
const parsedTasks: { type: string; direction: string; output: string }[] = [];

for (const line of ganyuText.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const parts = trimmed.split("|").map(s => s.trim());
  if (parts.length >= 3) {
    const type = parts[0].toLowerCase();
    if (AGENT_TYPES.includes(type)) {
      parsedTasks.push({ type, direction: parts[1], output: parts[2] });
    }
  }
}

// 如果甘雨输出解析失败，回退到默认任务列表
if (parsedTasks.length < 5) {
  console.log("  ⚠ 甘雨意图解析产出不足，使用默认任务列表");
  parsedTasks.length = 0;
  for (const [type, role] of Object.entries(AGENT_ROLES)) {
    const outputName = `${role.name.toLowerCase()}-review.md`.replace(/\s+/g, "-");
    parsedTasks.push({ type, direction: `验证 ${role.domain}`, output: outputName });
  }
}

console.log(`🔰 甘雨生成 ${parsedTasks.length} 个任务 ⏱ ${((Date.now() - p0Start) / 1000).toFixed(0)}s`);

// ════════════════════════════════════════════════════════
// §7 Phase 1: Agent 认领执行
// ════════════════════════════════════════════════════════
const p1Nodes = parsedTasks.map((t) =>
  makeNode(`exam-${t.type}`, t.type, [t.type], [
    `# 核心链路验证：${AGENT_ROLES[t.type]?.name ?? t.type}（${t.type}）`,
    ``,
    `## 验证方向`,
    t.direction,
    ``,
    `## 要求`,
    `- 用 read_file / search_code / list_files / run_shell 自由探索`,
    `- **核心目标**: 判断核心链路是否健康运转，能跑起来就证明链路正常`,
    `- 只有真正导致运行时崩溃或编译失败的才算阻断性问题`,
    `- 不要纠结非空断言、console.error、缩进风格等零散代码瑕疵`,
    `- 结论格式: "✅ 核心链路正常" 或 "❌ 核心链路异常: (具体阻断项)"`,
    `- 将验证报告写入 ${path.join(OUTPUT, t.output)}`,
    `- 保持简洁，不超过 2000 字`,
  ].join("\n"))
);
addNodes(p1Nodes);

const p1Start = Date.now();
const p1Result = await engine.scheduler.executeAll();
printPhaseResult("Phase 1 独立探索", p1Result, p1Start);

// ════════════════════════════════════════════════════════
// §8 Phase 2: 交叉验证
// ════════════════════════════════════════════════════════
const p1Outputs = parsedTasks.filter(t => fs.existsSync(path.join(OUTPUT, t.output)));

// 生成配对：按相邻类型互审
const verifyPairs: { reviewer: string; name: string; target: string; targetName: string; output: string }[] = [];
for (let i = 0; i < p1Outputs.length; i += 2) {
  if (i + 1 >= p1Outputs.length) break;
  const a = p1Outputs[i];
  const b = p1Outputs[i + 1];
  const aRole = AGENT_ROLES[a.type];
  const bRole = AGENT_ROLES[b.type];
  verifyPairs.push({
    reviewer: a.type, name: aRole?.name ?? a.type,
    target: b.output, targetName: `${bRole?.name ?? b.type}的报告`,
    output: `${a.type}-verify-${b.type}.md`,
  });
  verifyPairs.push({
    reviewer: b.type, name: bRole?.name ?? b.type,
    target: a.output, targetName: `${aRole?.name ?? a.type}的报告`,
    output: `${b.type}-verify-${a.type}.md`,
  });
}

if (verifyPairs.length === 0) {
  console.log("  ⚠ Phase 1 产出不足，跳过交叉验证");
} else {
  const p2Nodes = verifyPairs.map((vp) => {
    const targetContent = readReport(vp.target);
    return makeNode(`verify-${vp.reviewer}-${vp.target.replace(".md", "")}`, vp.reviewer, [vp.reviewer], [
      `# 交叉验证：${vp.name} 审查 ${vp.targetName}`,
      ``,
      `## 被审报告内容（${vp.target}）`,
      targetContent.slice(0, 12000),
      ``,
      `## 验证指令`,
      `1. 逐条核实被审报告中的关键声称——用 read_file 打开声称的文件和行号`,
      `2. 标记矛盾之处：报告声称 X，实际代码是 Y`,
      `3. 补充被遗漏的严重问题`,
      `4. 将验证结论写入 ${path.join(OUTPUT, vp.output)}`,
      `5. 格式：\`| # | 声称 | 核实结果 | 实际证据 |\``,
      ``,
      `保持简洁，不超过 6000 字。`,
    ].join("\n"));
  });

  addNodes(p2Nodes);
  const p2Start = Date.now();
  const p2Result = await engine.scheduler.executeAll();
  printPhaseResult("Phase 2 交叉验证", p2Result, p2Start);
}

// ════════════════════════════════════════════════════════
// §9 Phase 3: 发现矩阵汇总
// ════════════════════════════════════════════════════════
const allP1Outputs = parsedTasks.map(t => `### ${t.output}\n${readReport(t.output).slice(0, 4000)}`).join("\n\n");
const allP2Files = fs.existsSync(OUTPUT)
  ? fs.readdirSync(OUTPUT).filter(f => f.includes("-verify-") && f.endsWith(".md"))
  : [];
const allP2Outputs = allP2Files.map(f => `### ${f}\n${readReport(f).slice(0, 3000)}`).join("\n\n");

const p3Node = makeNode("findings-matrix", "analysis", ["analysis"], [
  `# 任务：扫描全部 Phase 1 + Phase 2 报告，生成发现汇总清单`,
  ``,
  `## Phase 1 独立探索报告（摘要）`,
  allP1Outputs,
  ``,
  `## Phase 2 交叉验证报告（摘要）`,
  allP2Outputs || "(无交叉验证报告)",
  ``,
  `## 输出要求`,
  `生成精简发现清单，每条一行，格式：`,
  `\`| FIND-XXX | 严重度 | 来源Agent | 文件:行号 | 一句话描述 | 交叉验证状态 |\``,
  ``,
  `严重度: 🔴阻断 🟠严重 🟡一般 🔵提示`,
  `交叉验证状态: ✅已核实 ⚠️待确认 ❌被反驳 —未验证`,
  ``,
  `将清单写入 ${path.join(OUTPUT, "findings-matrix.md")}`,
  `总数控制在 50 条以内，合并同类发现。`,
].join("\n"));

addNodes([p3Node]);
const p3Start = Date.now();
const p3Result = await engine.scheduler.executeAll();
printPhaseResult("Phase 3 发现矩阵", p3Result, p3Start);

// ════════════════════════════════════════════════════════
// §10 Phase 4a: 全员归因圆桌（单视角并行）
// ════════════════════════════════════════════════════════
const findingsMatrix = readReport("findings-matrix.md");

// 收集已成功的 Phase 1 agent 类型
const successfulTypes = new Set<string>(
  engine.board.getAllNodes()
    .filter(n => n.status === "done" && n.id.startsWith("exam-"))
    .map(n => n.tags[0] as string)
);

// 为每个成功的 Agent + strategist 创建独立发言 node
const roundtableNodes: TaskNode[] = [];
const roundtableParticipants: string[] = [];

for (const type of AGENT_TYPES) {
  if (!successfulTypes.has(type)) continue;
  const role = AGENT_ROLES[type]!;
  roundtableParticipants.push(type);
  roundtableNodes.push(makeNode(
    `roundtable-${type}`, type, [type],
    [
      `# 归因圆桌发言：${role?.name ?? type}（${type}）`,
      ``,
      `## 发现清单`,
      findingsMatrix.slice(0, 2000),
      ``,
      `## 你的视角`,
      role ? `你专精于 ${role.domain}。请基于发现清单，确认/反驳与你领域相关的条目。` : "请基于发现清单，从你的领域视角发言。",
      ``,
      `## 要求`,
      `- 确认/反驳与你领域相关的 FIND-XXX，给出根因归类（代码/架构/配置/流程）`,
      `- 发言 ≤ 300 字`,
      `- 将发言写入 ${path.join(OUTPUT, `roundtable-${type}.md`)}`,
    ].join("\n")
  ));
}

// 钟离发言 node
roundtableParticipants.push("strategist-zhongli");
roundtableNodes.push(makeNode(
  "roundtable-strategist-zhongli", "strategist", ["strategist"],
  [
    `# 归因圆桌发言：钟离（strategist）`,
    ``,
    `## 发现清单`,
    findingsMatrix.slice(0, 2000),
    ``,
    `## 你的视角`,
    `你是钟离，Cortex 战略顾问。从战略一致性角度评估：这些发现是否指向系统性的方向偏差？`,
    ``,
    `## 要求`,
    `- 判断哪些发现是系统性偏差而非孤立问题`,
    `- 发言 ≤ 300 字`,
    `- 将发言写入 ${path.join(OUTPUT, "roundtable-zhongli.md")}`,
  ].join("\n")
));

// 霜凝发言 node
roundtableParticipants.push("strategist-shuangning");
roundtableNodes.push(makeNode(
  "roundtable-strategist-shuangning", "strategist", ["strategist"],
  [
    `# 归因圆桌发言：霜凝（strategist）`,
    ``,
    `## 发现清单`,
    findingsMatrix.slice(0, 2000),
    ``,
    `## 你的视角`,
    `你是霜凝，Cortex 监理。从未来演进方向评估：哪些发现如果不修复会成为 Core-2 阶段的障碍？`,
    ``,
    `## 要求`,
    `- 标记会阻碍后续阶段演进的发现`,
    `- 发言 ≤ 300 字`,
    `- 将发言写入 ${path.join(OUTPUT, "roundtable-shuangning.md")}`,
  ].join("\n")
));

if (roundtableNodes.length === 0) {
  console.log("  ⚠ 没有可用 Agent 参与圆桌");
} else {
  addNodes(roundtableNodes);
  const p4aStart = Date.now();
  const p4aResult = await engine.scheduler.executeAll();
  printPhaseResult("Phase 4a 归因圆桌", p4aResult, p4aStart);

  // 列出所有圆桌发言文件
  const speechFiles = fs.existsSync(OUTPUT)
    ? fs.readdirSync(OUTPUT).filter(f => f.startsWith("roundtable-") && f.endsWith(".md"))
    : [];
  for (const f of speechFiles) {
    console.log(`  📄 发言: ${f}`);
  }
}

// ════════════════════════════════════════════════════════
// §11 Phase 4b: 凝光宪法审计（直接 LLM 调用）
// ════════════════════════════════════════════════════════
const roundtableSpeeches = fs.existsSync(OUTPUT)
  ? fs.readdirSync(OUTPUT).filter(f => f.startsWith("roundtable-") && f.endsWith(".md"))
      .map(f => `### ${f}\n${readReport(f).slice(0, 2000)}`)
      .join("\n\n")
  : "(无圆桌发言)";

const constitutionDocs = ["Cortex 概念顶层设计 v2.5.md", "Cortex 概念顶层设计 v2.3.md"]
  .map(f => {
    const p = path.join(ROOT, "docs", f);
    return fs.existsSync(p) ? `### ${f}\n${fs.readFileSync(p, "utf-8").slice(0, 5000)}` : `### ${f}\n(文件不存在)`;
  })
  .join("\n\n");

const p4bStart = Date.now();
const ningguangResponse = await reasonerAdapter.chat(REASONER_MODEL, [
  { role: "system", content: "你是凝光，Cortex 门下省审计官。你的职责是审查工程实践与宪法治理声明的一致性。从发现清单和圆桌发言中，提取与宪法条款不一致的事项。" },
  { role: "user", content: [
    `# 宪法一致性审计`,
    ``,
    `## 发现矩阵`,
    findingsMatrix.slice(0, 3000),
    ``,
    `## 圆桌发言`,
    roundtableSpeeches.slice(0, 6000),
    ``,
    `## 宪法文档（摘要）`,
    constitutionDocs.slice(0, 5000),
    ``,
    `## 输出要求`,
    `1. 逐条比对发现与宪法条款，标记不一致处`,
    `2. 区分"宪法直接违规"和"与宪法精神不一致"`,
    `3. 简要评估每项不一致的严重度`,
    `4. 写入 ${path.join(OUTPUT, "ningguang-constitution-audit.md")}`,
    `控制在 3000 字以内。`,
  ].join("\n") },
]);
const p4bElapsed = ((Date.now() - p4bStart) / 1000).toFixed(0);
console.log(`Phase 4b 凝光审计: ✅ ⏱ ${p4bElapsed}s`);

if (ningguangResponse.content) {
  fs.writeFileSync(path.join(OUTPUT, "ningguang-constitution-audit.md"), ningguangResponse.content, "utf-8");
}

// ════════════════════════════════════════════════════════
// §12 Phase 4c: 钟离战略评估 + 霜凝监理展望
// ════════════════════════════════════════════════════════
const ningguangAudit = readReport("ningguang-constitution-audit.md");

const p4cStart = Date.now();
const [zhongliResponse, shuangningResponse] = await Promise.all([
  reasonerAdapter.chat(REASONER_MODEL, [
    { role: "system", content: "你是钟离，Cortex 战略顾问。从系统性方向偏差角度评估发现。" },
    { role: "user", content: [
      `# 战略评估`,
      `## 发现清单`,
      findingsMatrix.slice(0, 2000),
      `## 圆桌发言`,
      roundtableSpeeches.slice(0, 3000),
      `## 要求`,
      `判断哪些发现指向系统性的方向偏差（而非孤立缺陷），评估对 Core 阶段演进的战略影响。`,
      `控制在 1500 字以内。`,
    ].join("\n") },
  ]),
  reasonerAdapter.chat(REASONER_MODEL, [
    { role: "system", content: "你是霜凝，Cortex 监理。从未来演进方向评估发现，标记 Core-2 阶段的潜在障碍。" },
    { role: "user", content: [
      `# 监理展望`,
      `## 发现清单`,
      findingsMatrix.slice(0, 2000),
      `## 圆桌发言`,
      roundtableSpeeches.slice(0, 3000),
      `## 要求`,
      `标记哪些发现如果不修复会成为 Core-2 阶段的障碍，给出优先级建议。`,
      `控制在 1500 字以内。`,
    ].join("\n") },
  ]),
]);

const p4cElapsed = ((Date.now() - p4cStart) / 1000).toFixed(0);
console.log(`Phase 4c 钟离+霜凝: ✅ ⏱ ${p4cElapsed}s`);

if (zhongliResponse.content) {
  fs.writeFileSync(path.join(OUTPUT, "zhongli-strategic-assessment.md"), zhongliResponse.content, "utf-8");
}
if (shuangningResponse.content) {
  fs.writeFileSync(path.join(OUTPUT, "shuangning-oversight-review.md"), shuangningResponse.content, "utf-8");
}

// ════════════════════════════════════════════════════════
// §13 Phase 5: 昔涟优先级裁决 → 共识修复清单
// ════════════════════════════════════════════════════════
const cyreneSystemPrompt = fs.existsSync(path.join(ROOT, "prompts", "cyrene", "system.md"))
  ? fs.readFileSync(path.join(ROOT, "prompts/cyrene/system.md"), "utf-8")
  : "你是昔涟，记忆命途守望者。";

const zhongliAssessment = readReport("zhongli-strategic-assessment.md");
const shuangningReview = readReport("shuangning-oversight-review.md");

const p5Payload = [
  `# 优先级裁决任务`,
  ``,
  `你是昔涟。你是 Cortex 的终审裁决者，不是签署人。`,
  `本次软约束自审视全部阶段已完成。请基于以下全部材料，产出共识修复清单及优先级排序。`,
  ``,
  `## 裁决原则`,
  `- 你拥有全维视角和终审裁决权`,
  `- 从工程演进历史视角看待发现（Meso-Lite → Core-1 历程）`,
  `- 从宪法一致性角度判断治理声明落实度`,
  `- 标记跨阶段反复出现的债务`,
  `- **你不签署**，你只裁决优先级安排（P0/P1/P2）`,
  ``,
  `## 发现矩阵`,
  findingsMatrix.slice(0, 4000),
  ``,
  `## 圆桌发言`,
  roundtableSpeeches.slice(0, 4000),
  ``,
  `## 凝光宪法审计`,
  ningguangAudit.slice(0, 3000),
  ``,
  `## 钟离战略评估`,
  zhongliAssessment.slice(0, 2000),
  ``,
  `## 霜凝监理展望`,
  shuangningReview.slice(0, 2000),
  ``,
  `## 全部产出文件`,
  listOutputs().join("\n"),
  ``,
  `## 输出要求`,
  `将以下内容写入 ${path.join(OUTPUT, "consensus-repair-list.md")}：`,
  ``,
  `1. **共识修复清单**（P0/P1/P2 三级优先级排序）`,
  `   - P0（立即修复）: 会导致运行时崩溃、编译失败、CI 门禁阻断`,
  `   - P1（本阶段修复）: 影响核心链路健康、宪法一致性问题`,
  `   - P2（下阶段修复）: 技术债务、配置漂移、文档不一致`,
  `2. **矛盾标记**（Agent A 与 Agent B 结论冲突的 FIND-ID）`,
  `3. **跨版本复发标记**（哪些问题在 Meso-Lite → Core-1 反复出现）`,
  `4. **宪法一致性摘要**（凝光审计报告的关键结论）`,
  ``,
  `总报告不超过 8000 字。`,
].join("\n");

const p5Start = Date.now();
const p5Response = await cyreneAdapter.chat(CHAT_MODEL, [
  { role: "system", content: cyreneSystemPrompt },
  { role: "user", content: p5Payload },
]);
const p5Elapsed = ((Date.now() - p5Start) / 1000).toFixed(0);

if (p5Response.content) {
  fs.writeFileSync(path.join(OUTPUT, "consensus-repair-list.md"), p5Response.content!, "utf-8");
}
console.log(`Phase 5 昔涟裁决: ✅ ⏱ ${p5Elapsed}s`);

// ════════════════════════════════════════════════════════
// §14 汇总
// ════════════════════════════════════════════════════════
const finalOutputs = listOutputs();
console.log(`\n✅ 产出 ${finalOutputs.length} 个文件`);
console.log(finalOutputs.join("\n"));

// ════════════════════════════════════════════════════════
// §15 清理
// ════════════════════════════════════════════════════════
console.log = originalConsoleLog;
try { await engine.memory?.close?.(); } catch {}