/**
 * 软约束自审视 —— 对称配对攻防 4 阶段流程
 *
 * Phase 1: 6 Agent 出 Claims（结构化 JSON，不写散文）
 *   - 莫娜(loop) → claims-loop.json
 *   - 久岐忍(api) → claims-api.json
 *   - 北斗(ops) → claims-ops.json
 *   - 安柏(inspector) → claims-inspector.json
 *   - 艾尔海森(data) → claims-data.json
 *   - 刻晴(review) → claims-review.json
 * Phase 2: 对称攻防（3 对互相举证推翻）
 *   - 莫娜 ↔ 刻晴
 *   - 久岐忍 ↔ 北斗
 *   - 安柏 ↔ 艾尔海森
 * Phase 3: 纳西妲裁决（读 claims + attacks，产出裁决）
 * Phase 4: 凝光合成（基于裁决产出最终报告）
 *
 * 用法: npx tsx scripts/self-exam-soft.ts
 * 前提: .env 已配置 DEEPSEEK_API_KEY, DEEPSEEK_CYRENE_KEY
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { bootstrapEngine } from "@cortex/engine";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "@cortex/platform";
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
  // claims/attack 文件
  if (msg.includes("claims-") || msg.includes("attack-")) return true;
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
const CYRENE_KEY = process.env.DEEPSEEK_CYRENE_API_KEY ?? API_KEY;
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

// 非交互模式自动批准——自审视无需人工确认
toolkit.setGate?.(engine.gate);
engine.gate?.setBridge?.({
  confirm: async (req: any) => ({ requestId: req.id, approved: true }),
  notify: (_msg: string) => {},
});

// ════════════════════════════════════════════════════════
// §5 Agent 类型与角色定义（新流程：6 出证 + 1 裁决 + 1 合成）
// ════════════════════════════════════════════════════════
const AGENT_ROLES: Record<string, { name: string; domain: string }> = {
  loop:      { name: "莫娜",     domain: "MemoryStore 生产→存储→检索→去重闭环；事件总线发布→订阅→投递" },
  review:    { name: "刻晴",     domain: "typecheck→build→test 三连绿灯，CI 脚本可执行" },
  ops:       { name: "北斗",     domain: "包依赖完整性、workspace 拓扑、构建产物一致性" },
  inspector: { name: "安柏",     domain: "目录无孤儿文件、配置漂移检测、tsconfig references 一致性" },
  data:      { name: "艾尔海森", domain: "MemoryStore schema 完整性、读写一致性、迁移兼容性" },
  api:       { name: "久岐忍",   domain: "engine 公开 API barrel 导出完整性，外部 import 无断裂" },
  analysis:  { name: "纳西妲",   domain: "裁决者——接收全部 claims + attacks，产出权威裁决" },
  "doc-govern": { name: "凝光",  domain: "合成者——基于裁决产出最终修复建议报告" },
};

const AGENT_TYPES = Object.keys(AGENT_ROLES);

// 出证 Agent（6 个）：
const CLAIM_AGENTS = ["loop", "api", "ops", "inspector", "data", "review"] as const;

// 攻防配对（3 对）：
const ATTACK_PAIRS: [string, string][] = [
  ["loop", "review"],    // 莫娜 ↔ 刻晴
  ["api", "ops"],        // 久岐忍 ↔ 北斗
  ["inspector", "data"], // 安柏 ↔ 艾尔海森
];

// Agent type → Agent name 映射
function agentName(type: string): string {
  return AGENT_ROLES[type]?.name ?? type;
}

function claimFile(type: string): string {
  return `claims-${type}.json`;
}

function attackFile(attacker: string, target: string): string {
  return `attack-${attacker}-vs-${target}.json`;
}

// ════════════════════════════════════════════════════════
// §6 预算跟踪 + 辅助函数
// ════════════════════════════════════════════════════════
const BUDGET_MAX_TOKENS = parseInt(
  process.env.SELF_EXAM_MAX_TOKENS ?? "1000000", 10
);
let totalTokensUsed = 0;

async function callLlm(
  adapter: LlmAdapter,
  model: string,
  messages: { role: string; content: string }[],
): Promise<{ content: string | null; tokens: number }> {
  const resp = await adapter.chat(model, messages);
  const tokens = (resp as any).usage?.totalTokens ?? 0;
  totalTokensUsed += tokens;
  return { content: resp.content ?? null, tokens };
}

function budgetOk(): boolean {
  if (totalTokensUsed >= BUDGET_MAX_TOKENS) {
    console.log(`  ⚠ 预算耗尽 (${totalTokensUsed}/${BUDGET_MAX_TOKENS})，跳过后续 Phase`);
    return false;
  }
  return true;
}

function writeJson(name: string, data: unknown): void {
  fs.writeFileSync(path.join(OUTPUT, name), JSON.stringify(data, null, 2), "utf-8");
}

function readJson<T>(name: string): T | null {
  const p = path.join(OUTPUT, name);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) as T; } catch { return null; }
}

// ════════════════════════════════════════════════════════
// §7 Phase 1: 6 Agent 出 Claims（engine scheduler，产出结构化 JSON）
// ════════════════════════════════════════════════════════

const CLAIM_SYSTEM_PROMPTS: Record<string, string> = {
  loop: [
    "你是莫娜，Cortex 记忆闭环侦探。",
    "",
    "你的领域：MemoryStore 生产→存储→检索→去重闭环；事件总线发布→订阅→投递。",
    "",
    "## 任务",
    "用 read_file / search_code / list_files / run_shell 自由探索代码库，",
    "找出你领域中确实存在的阻断性/严重问题。",
    "只输出高质量 claim：有明确证据（文件:行号）、可复现、非风格问题。",
    "",
    "## 输出格式",
    "输出 JSON 到 test-output/self-examination-soft/claims-loop.json，格式如下：",
    JSON.stringify({
      agent: "莫娜", type: "loop",
      claims: [
        { id: "L-01", severity: "critical", claim: "...", evidence: "文件路径:行号", confidence: 0.95 },
      ],
    }, null, 2),
    "",
    "id 前缀用 L-。severity: critical|high|medium|low。confidence: 0.0~1.0。",
    "如无重要发现，返回空 claims 数组。最多 8 条。",
  ].join("\n"),

  api: [
    "你是久岐忍，Cortex API 完整性守护者。",
    "",
    "你的领域：engine 公开 API barrel 导出完整性，外部 import 无断裂。",
    "",
    "## 任务",
    "用 read_file / search_code / list_files / run_shell 自由探索代码库，",
    "找出你领域中确实存在的阻断性/严重问题。",
    "只输出高质量 claim：有明确证据（文件:行号）、可复现、非风格问题。",
    "",
    "## 输出格式",
    "输出 JSON 到 test-output/self-examination-soft/claims-api.json，格式如下：",
    JSON.stringify({
      agent: "久岐忍", type: "api",
      claims: [
        { id: "A-01", severity: "critical", claim: "...", evidence: "文件路径:行号", confidence: 0.95 },
      ],
    }, null, 2),
    "",
    "id 前缀用 A-。severity: critical|high|medium|low。confidence: 0.0~1.0。",
    "如无重要发现，返回空 claims 数组。最多 8 条。",
  ].join("\n"),

  ops: [
    "你是北斗，Cortex 运维稳定性守护者。",
    "",
    "你的领域：包依赖完整性、workspace 拓扑、构建产物一致性。",
    "",
    "## 任务",
    "用 read_file / search_code / list_files / run_shell 自由探索代码库，",
    "找出你领域中确实存在的阻断性/严重问题。",
    "只输出高质量 claim：有明确证据（文件:行号）、可复现、非风格问题。",
    "",
    "## 输出格式",
    "输出 JSON 到 test-output/self-examination-soft/claims-ops.json，格式如下：",
    JSON.stringify({
      agent: "北斗", type: "ops",
      claims: [
        { id: "O-01", severity: "critical", claim: "...", evidence: "文件路径:行号", confidence: 0.95 },
      ],
    }, null, 2),
    "",
    "id 前缀用 O-。severity: critical|high|medium|low。confidence: 0.0~1.0。",
    "如无重要发现，返回空 claims 数组。最多 8 条。",
  ].join("\n"),

  inspector: [
    "你是安柏，Cortex 侦察先锋。",
    "",
    "你的领域：目录无孤儿文件、配置漂移检测、tsconfig references 一致性。",
    "",
    "## 任务",
    "用 read_file / search_code / list_files / run_shell 自由探索代码库，",
    "找出你领域中确实存在的阻断性/严重问题。",
    "只输出高质量 claim：有明确证据（文件:行号）、可复现、非风格问题。",
    "",
    "## 输出格式",
    "输出 JSON 到 test-output/self-examination-soft/claims-inspector.json，格式如下：",
    JSON.stringify({
      agent: "安柏", type: "inspector",
      claims: [
        { id: "I-01", severity: "critical", claim: "...", evidence: "文件路径:行号", confidence: 0.95 },
      ],
    }, null, 2),
    "",
    "id 前缀用 I-。severity: critical|high|medium|low。confidence: 0.0~1.0。",
    "如无重要发现，返回空 claims 数组。最多 8 条。",
  ].join("\n"),

  data: [
    "你是艾尔海森，Cortex 数据完整性分析师。",
    "",
    "你的领域：MemoryStore schema 完整性、读写一致性、迁移兼容性。",
    "",
    "## 任务",
    "用 read_file / search_code / list_files / run_shell 自由探索代码库，",
    "找出你领域中确实存在的阻断性/严重问题。",
    "只输出高质量 claim：有明确证据（文件:行号）、可复现、非风格问题。",
    "",
    "## 输出格式",
    "输出 JSON 到 test-output/self-examination-soft/claims-data.json，格式如下：",
    JSON.stringify({
      agent: "艾尔海森", type: "data",
      claims: [
        { id: "D-01", severity: "critical", claim: "...", evidence: "文件路径:行号", confidence: 0.95 },
      ],
    }, null, 2),
    "",
    "id 前缀用 D-。severity: critical|high|medium|low。confidence: 0.0~1.0。",
    "如无重要发现，返回空 claims 数组。最多 8 条。",
  ].join("\n"),

  review: [
    "你是刻晴，Cortex 代码审查官。",
    "",
    "你的领域：typecheck→build→test 三连绿灯，CI 脚本可执行性。",
    "",
    "## 任务",
    "用 read_file / search_code / list_files / run_shell 自由探索代码库，",
    "找出你领域中确实存在的阻断性/严重问题。",
    "只输出高质量 claim：有明确证据（文件:行号）、可复现、非风格问题。",
    "",
    "## 输出格式",
    "输出 JSON 到 test-output/self-examination-soft/claims-review.json，格式如下：",
    JSON.stringify({
      agent: "刻晴", type: "review",
      claims: [
        { id: "R-01", severity: "critical", claim: "...", evidence: "文件路径:行号", confidence: 0.95 },
      ],
    }, null, 2),
    "",
    "id 前缀用 R-。severity: critical|high|medium|low。confidence: 0.0~1.0。",
    "如无重要发现，返回空 claims 数组。最多 8 条。",
  ].join("\n"),
};

// 构建 Phase 1 任务节点——用 engine scheduler 让 Agent 自由探索
const p1Nodes = CLAIM_AGENTS.map((type) =>
  makeNode(`claim-${type}`, type, [type], [
    CLAIM_SYSTEM_PROMPTS[type],
  ].join("\n"))
);
addNodes(p1Nodes);

const p1Start = Date.now();
const p1Result = await engine.scheduler.executeAll();
printPhaseResult("Phase 1 出 Claims", p1Result, p1Start);

// 统计 claim 数量
const claimCounts: Record<string, number> = {};
let totalClaims = 0;
for (const type of CLAIM_AGENTS) {
  const data = readJson<{ claims: unknown[] }>(claimFile(type));
  const n = data?.claims?.length ?? 0;
  claimCounts[agentName(type)] = n;
  totalClaims += n;
}
console.log(`  📊 共 ${totalClaims} 条 claims: ${Object.entries(claimCounts).map(([k, v]) => `${k} ${v}`).join(" | ")}`);

// ════════════════════════════════════════════════════════
// §8 Phase 2: 对称攻防（3 对，互相举证推翻）
// ════════════════════════════════════════════════════════

// 预算不足时降级：每个 Agent 只攻击最相关的一个对手
const useReducedPairs = !budgetOk();

const attackNodes: TaskNode[] = [];

function buildAttackTask(
  attacker: string,
  target: string,
  targetClaimsContent: string,
): TaskNode {
  const aname = agentName(attacker);
  const tname = agentName(target);
  return makeNode(`attack-${attacker}-vs-${target}`, attacker, [attacker], [
    `# 对称攻防：${aname} 挑战 ${tname}`,
    ``,
    `你是 ${aname}（${attacker}）。你的对手 ${tname}（${target}）提出以下 claims：`,
    ``,
    targetClaimsContent,
    ``,
    `## 任务`,
    `逐条审查对方 claims。用 read_file / search_code 打开声称的文件和行号，`,
    `核实每条 claim 的真实性。找反例——实际代码是否支持对方的声称？`,
    ``,
    `## 输出格式`,
    `输出 JSON 到 test-output/self-examination-soft/${attackFile(attacker, target)}，格式如下：`,
    JSON.stringify({
      attacker: aname,
      target: tname,
      attacks: [
        {
          targetClaimId: "L-01",
          verdict: "OVERTURNED|CONFIRMED|REFINED",
          reason: "实际代码/日志证据",
          evidence: "文件路径:行号",
        },
      ],
    }, null, 2),
    ``,
    `verdict: OVERTURNED（推翻）、CONFIRMED（确认）、REFINED（修正范围）`,
    `最多 300 字/条。保持客观，基于代码事实。`,
  ].join("\n"));
}

// 收集可用的 claim 文件
const availableClaims: Record<string, string> = {};
for (const type of CLAIM_AGENTS) {
  const f = claimFile(type);
  const p = path.join(OUTPUT, f);
  if (fs.existsSync(p)) {
    availableClaims[type] = fs.readFileSync(p, "utf-8");
  }
}

if (useReducedPairs) {
  console.log("  ⚡ 预算降级模式：每个 Agent 攻击最相关的一个对手");
  for (const [a, b] of ATTACK_PAIRS) {
    if (availableClaims[a] && availableClaims[b]) {
      attackNodes.push(buildAttackTask(a, b, availableClaims[b]));
    }
  }
} else {
  for (const [a, b] of ATTACK_PAIRS) {
    if (availableClaims[a] && availableClaims[b]) {
      attackNodes.push(buildAttackTask(a, b, availableClaims[b]));
      attackNodes.push(buildAttackTask(b, a, availableClaims[a]));
    }
  }
}

if (attackNodes.length === 0) {
  console.log("  ⚠ 无可用 claims，跳过 Phase 2");
} else {
  addNodes(attackNodes);
  const p2Start = Date.now();
  const p2Result = await engine.scheduler.executeAll();
  printPhaseResult("Phase 2 对称攻防", p2Result, p2Start);
}

// ════════════════════════════════════════════════════════
// §9 Phase 3: 纳西妲裁决（直接 LLM 调用）
// ════════════════════════════════════════════════════════
if (!budgetOk()) {
  console.log("  跳过 Phase 3（预算不足）");
} else {
  // 收集全部 claims
  const allClaimsJson: Record<string, unknown> = {};
  for (const type of CLAIM_AGENTS) {
    const data = readJson(claimFile(type));
    if (data) allClaimsJson[agentName(type)] = data;
  }

  // 收集全部 attack 文件
  const attackFiles = fs.existsSync(OUTPUT)
    ? fs.readdirSync(OUTPUT).filter(f => f.startsWith("attack-") && f.endsWith(".json"))
    : [];
  const allAttacksJson: Record<string, unknown> = {};
  for (const f of attackFiles) {
    const data = readJson(f);
    if (data) allAttacksJson[f.replace(".json", "")] = data;
  }

  const p3Start = Date.now();
  const p3Response = await callLlm(reasonerAdapter, REASONER_MODEL, [
    {
      role: "system",
      content: [
        "你是纳西妲，Cortex 真理裁决者。你的职责是：",
        "1. 读取全部 6 份 claims（各 Agent 的发现声称）",
        "2. 读取全部 attack 文件（对称攻防的互相反驳）",
        "3. 逐条裁决每条 claim 被攻击后是否存活",
        "",
        "## 裁决标准",
        "- CONFIRMED: 攻击无效，claim 成立（证据充分且未被推翻）",
        "- OVERTURNED: 攻击有效，claim 被推翻（反例确凿）",
        "- REFINED: 部分成立，需要修正 claim 的范围或严重度",
        "",
        "只输出 JSON，不写散文。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "# 全部 Claims",
        JSON.stringify(allClaimsJson, null, 2),
        "",
        "# 全部 Attacks",
        JSON.stringify(allAttacksJson, null, 2),
        "",
        "## 输出格式",
        "输出 JSON 如下：",
        JSON.stringify({
          judge: "纳西妲",
          verdicts: [
            {
              claimId: "L-01",
              attacks: ["OVERTURNED"],
              finalStatus: "CONFIRMED|OVERTURNED|REFINED",
              reasoning: "裁决理由",
            },
          ],
          survivingClaims: ["L-01"],
        }, null, 2),
      ].join("\n"),
    },
  ]);

  const p3Elapsed = ((Date.now() - p3Start) / 1000).toFixed(0);
  console.log(`Phase 3 纳西妲裁决: ✅ ⏱ ${p3Elapsed}s (tokens: ${p3Response.tokens})`);

  if (p3Response.content) {
    writeJson("verdict-analysis.json", (() => {
      try { return JSON.parse(p3Response.content); }
      catch { return { judge: "纳西妲", raw: p3Response.content }; }
    })());
  }
}

// ════════════════════════════════════════════════════════
// §10 Phase 4: 凝光合成最终报告
// ════════════════════════════════════════════════════════
if (!budgetOk()) {
  console.log("  跳过 Phase 4（预算不足）");
} else {
  const verdictData = readJson("verdict-analysis.json");
  const allClaimsSummary: string[] = [];
  for (const type of CLAIM_AGENTS) {
    const data = readJson(claimFile(type));
    if (data) {
      allClaimsSummary.push(
        `### ${agentName(type)} (${type})\n\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 2000)}\n\`\`\``
      );
    }
  }

  const attackFiles = fs.existsSync(OUTPUT)
    ? fs.readdirSync(OUTPUT).filter(f => f.startsWith("attack-") && f.endsWith(".json"))
    : [];
  const attackSummary: string[] = [];
  for (const f of attackFiles) {
    const data = readJson(f);
    if (data) {
      attackSummary.push(
        `### ${f}\n\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 2000)}\n\`\`\``
      );
    }
  }

  const p4Start = Date.now();
  const p4Response = await callLlm(reasonerAdapter, REASONER_MODEL, [
    {
      role: "system",
      content: [
        "你是凝光，Cortex 门下省首席合成官。你的职责是：",
        "基于纳西妲的裁决，合成最终修复建议报告。",
        "这是唯一的散文输出——之前的全部阶段都是结构化 JSON。",
        "",
        "## 报告结构",
        "1. 执行摘要（2-3 句概述）",
        "2. 幸存 Claims（纳西妲确认的问题，按严重度排序）",
        "3. 被推翻 Claims（说明为什么被推翻）",
        "4. 修复建议（按 P0/P1/P2 优先级）",
        "5. 攻防摘要（哪些攻击最有力，哪些防御最薄弱）",
        "",
        "保持客观、简洁、可操作。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "# 纳西妲裁决",
        verdictData ? JSON.stringify(verdictData, null, 2) : "(裁决文件缺失)",
        "",
        "# 全部 Claims",
        allClaimsSummary.join("\n\n"),
        "",
        "# 全部 Attacks",
        attackSummary.join("\n\n"),
        "",
        "## 输出要求",
        "写入 test-output/self-examination-soft/final-report.md",
        "不超过 5000 字。只写散文报告，不输出 JSON。",
      ].join("\n"),
    },
  ]);

  const p4Elapsed = ((Date.now() - p4Start) / 1000).toFixed(0);
  console.log(`Phase 4 凝光合成: ✅ ⏱ ${p4Elapsed}s (tokens: ${p4Response.tokens})`);

  if (p4Response.content) {
    fs.writeFileSync(path.join(OUTPUT, "final-report.md"), p4Response.content!, "utf-8");
  }
}

// ════════════════════════════════════════════════════════
// §11 汇总
// ════════════════════════════════════════════════════════
function listAllOutputs(): string[] {
  if (!fs.existsSync(OUTPUT)) return [];
  return fs.readdirSync(OUTPUT).map(f => {
    const size = (fs.statSync(path.join(OUTPUT, f)).size / 1024).toFixed(1);
    return `  ${f} (${size}KB)`;
  });
}

const finalOutputs = listAllOutputs();
console.log(`\n✅ 产出 ${finalOutputs.length} 个文件 (token 消耗: ${totalTokensUsed})`);
console.log(finalOutputs.join("\n"));

// ════════════════════════════════════════════════════════
// §12 清理
// ════════════════════════════════════════════════════════
console.log = originalConsoleLog;
try { await engine.memory?.close?.(); } catch {}
