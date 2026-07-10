/**
 * @covers: 软约束自审视 — 对称配对攻防 7 阶段流程（E2E 版）
 *
 * 软约束自审视 —— 对称配对攻防 7 阶段流程（E2E 版）
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
 * Phase 4: 钟离战略过滤（基于裁决，产出优先级策略）
 * Phase 5: 霜凝方向监理（审视遗漏维度与流程弱点）
 * Phase 6: 凝光合成（基于裁决 + 钟离 + 霜凝产出最终报告）
 * Phase 7: (预留) 昔涟终裁
 *
 * 用法: npx tsx packages/engine/tests/manual/e2e/self-exam-soft.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY, DEEPSEEK_CYRENE_KEY
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { bootstrapEngine } from "@cortex/engine";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "@cortex/platform";
import type { TaskNode } from "@cortex/shared";
import type { ExecutionReport } from "@cortex/shared";
import { findProjectRoot, loadEnv } from "./e2e-utils.js";

// ════════════════════════════════════════════════════════
// §0 .env 加载 & 项目根
// ════════════════════════════════════════════════════════
const ROOT = findProjectRoot();
loadEnv(ROOT);

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

// 非交互模式自动批准——自审视无需人工确认
toolkit.setGate?.(engine.gate);
engine.gate?.setBridge?.({
  confirm: async (req: any) => ({ requestId: req.id, approved: true }),
  notify: (_msg: string) => {},
});

// ════════════════════════════════════════════════════════
// §5 Agent 类型与角色定义（新流程：6 出证 + 1 裁决 + 2 策略 + 1 合成）
// ════════════════════════════════════════════════════════
const AGENT_ROLES: Record<string, { name: string; domain: string }> = {
  loop:               { name: "莫娜",     domain: "MemoryStore 生产→存储→检索→去重闭环；事件总线发布→订阅→投递" },
  review:             { name: "刻晴",     domain: "typecheck→build→test 三连绿灯，CI 脚本可执行" },
  ops:                { name: "北斗",     domain: "包依赖完整性、workspace 拓扑、构建产物一致性" },
  inspector:          { name: "安柏",     domain: "目录无孤儿文件、配置漂移检测、tsconfig references 一致性" },
  data:               { name: "艾尔海森", domain: "MemoryStore schema 完整性、读写一致性、迁移兼容性" },
  api:                { name: "久岐忍",   domain: "engine 公开 API barrel 导出完整性，外部 import 无断裂" },
  analysis:           { name: "纳西妲",   domain: "裁决者——接收全部 claims + attacks，产出权威裁决" },
  "doc-govern":       { name: "凝光",     domain: "合成者——基于裁决产出最终修复建议报告" },
  "zhongli-strat":    { name: "钟离",     domain: "战略过滤——判断存活 claims 优先级、契约风险" },
  "shuangning-dir":   { name: "霜凝",     domain: "方向监理——审视遗漏维度、流程薄弱环节" },
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

// ── 空状态守护：即使无 claim，也必须跑最小化安检 ──
if (totalClaims === 0) {
  console.log("🧪 空状态守护启动——强制最小化安检");

  const allClaims: Array<{id: string; severity: string; summary: string; detail: string; source: string}> = [];
  const projectRoot = resolve(import.meta.dirname, "../../../..");

  // 1.1 tsc 编译检查（用 node_modules/.bin/tsc 避免 npx.ps1 噪音）
  try {
    const tscResult = execSync(`"${projectRoot}/node_modules/.bin/tsc.cmd" -b packages/engine/tsconfig.src.json --force`, {
      encoding: "utf-8", timeout: 60000, cwd: projectRoot, shell: "cmd.exe"
    });
    if (tscResult.includes("error TS")) {
      allClaims.push({
        id: "guard-tsc-001", severity: "P0",
        summary: "tsc 编译检查失败",
        detail: tscResult.slice(0, 500),
        source: "空状态守护/编译",
      });
    }
  } catch (e: any) {
    if (e.stderr?.includes("error TS") || e.stdout?.includes("error TS")) {
      allClaims.push({
        id: "guard-tsc-001", severity: "P0",
        summary: "tsc 编译检查失败",
        detail: (e.stderr || e.stdout || String(e)).slice(0, 500),
        source: "空状态守护/编译",
      });
    } else {
      console.log(`  ⚠️ tsc 检查异常: ${String(e).slice(0, 100)}`);
    }
  }

  // 1.2 vitest 全量
  try {
    const testResult = execSync(`"${projectRoot}/node_modules/.bin/vitest.cmd" run --no-color`, {
      encoding: "utf-8", timeout: 120000, cwd: resolve(projectRoot, "packages/engine"), shell: "cmd.exe"
    });
    if (testResult.includes("failed") && !testResult.includes("0 failed")) {
      allClaims.push({
        id: "guard-test-001", severity: "P0",
        summary: "vitest 测试失败", detail: testResult.slice(-500),
        source: "空状态守护/测试",
      });
    } else {
      console.log(`  ✅ vitest 通过`);
    }
  } catch (e: any) {
    if (e.stdout?.includes("failed") || e.stderr?.includes("failed")) {
      allClaims.push({
        id: "guard-test-001", severity: "P0",
        summary: "vitest 测试失败",
        detail: ((e.stdout || e.stderr || "") + String(e)).slice(-500),
        source: "空状态守护/测试",
      });
    }
  }

  // 1.3 依赖漂移检查
  try {
    const depResult = execSync(`"${projectRoot}/node_modules/.bin/pnpm.cmd" outdated --no-table`, {
      encoding: "utf-8", timeout: 30000, cwd: projectRoot, shell: "cmd.exe"
    });
    if (depResult.trim().length > 0 && depResult.includes(" ")) {
      allClaims.push({
        id: "guard-dep-001", severity: "P1",
        summary: "依赖漂移检测到过时包", detail: depResult.slice(0, 500),
        source: "空状态守护/依赖",
      });
    }
  } catch (e) {
    console.log(`  ⚠️ 依赖检查跳过: ${String(e).slice(0, 100)}`);
  }

  // 1.4 lint 检查
  try {
    const lintResult = execSync(`"${projectRoot}/node_modules/.bin/eslint.cmd" packages/engine/src --max-warnings 999`, {
      encoding: "utf-8", timeout: 60000, cwd: projectRoot, shell: "cmd.exe"
    });
    const errCount = (lintResult.match(/\d+ error/g) || []).length;
    if (errCount > 0) {
      allClaims.push({
        id: "guard-lint-001", severity: "P1",
        summary: `eslint 发现 ${errCount} 个错误`,
        detail: lintResult.slice(0, 500),
        source: "空状态守护/lint",
      });
    }
  } catch (e) {
    console.log(`  ⚠️ lint 检查跳过: ${String(e).slice(0, 100)}`);
  }

  // 合并 claims
  if (allClaims.length > 0) {
    for (const c of allClaims) {
      claims.push(c);
    }
    totalClaims = claims.length;
  }
  console.log(`空状态守护完成——${allClaims.length} 个 claim 自动生成`);
}

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
        "如果所有 claim 都被防御方推翻且无存活 claim，你必须在裁决中声明\"所有显式 claim 均被推翻，但此为显式 claim 的裁决结果——非显式风险（如依赖漂移、配置不一致）未被本次审查覆盖。建议启动空状态守护。\"",
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
// §10 Phase 4: 钟离 — 战略过滤
// ════════════════════════════════════════════════════════
if (!budgetOk()) {
  console.log("  跳过 Phase 4（预算不足）");
} else {
  const verdictData = readJson("verdict-analysis.json");

  const p4Start = Date.now();
  const p4Response = await callLlm(reasonerAdapter, REASONER_MODEL, [
    {
      role: "system",
      content: [
        "你是钟离，往生堂客卿，契约守护者。你的职责是：",
        "基于纳西妲的裁决，从契约视角审视存活 claims。",
        "",
        "## 任务",
        "1. 读取纳西妲的裁决（含存活 claims 列表）",
        "2. 逐条评估每条存活 claim：",
        "   - 优先级：P0（现在就该修）| P1（可以延后）| P2（观察）",
        "   - 契约风险：修这条是否可能破坏别处已有契约/约定",
        "   - 依赖关系：跟其他 claim 是否有前后依赖",
        "3. 给出总体战略判断",
        "",
        "## 阐释",
        "- P0: 阻断性/安全类，不修则风险递增",
        "- P1: 重要但短期内不会失控",
        "- P2: 值得关注但不急于动手",
        "- 契约视角：修一条 claim 会不会让另一条原本正常的逻辑断裂",
        "",
        "只输出 JSON，不写散文。",
        "当输入 claim 列表为空时，你不得直接声明\"无契约需维护\"。你必须指出\"输入为空，未经过主动巡检验证\"，并建议启动空状态守护。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "# 纳西妲裁决",
        verdictData ? JSON.stringify(verdictData, null, 2) : "(裁决文件缺失)",
        "",
        "## 输出格式",
        "输出 JSON 到 test-output/self-examination-soft/zhongli-strategy.json，格式如下：",
        JSON.stringify({
          judge: "钟离",
          assessments: [
            {
              claimId: "L-01",
              priority: "P0|P1|P2",
              contractRisk: "说明可能破坏哪些现有约定",
              dependency: "依赖或关联的其它 claim ID",
              recommendation: "建议操作",
            },
          ],
          overallStrategy: "总体战略判断",
        }, null, 2),
      ].join("\n"),
    },
  ]);

  const p4Elapsed = ((Date.now() - p4Start) / 1000).toFixed(0);
  console.log(`Phase 4 钟离战略过滤: ✅ ⏱ ${p4Elapsed}s (tokens: ${p4Response.tokens})`);

  if (p4Response.content) {
    writeJson("zhongli-strategy.json", (() => {
      try { return JSON.parse(p4Response.content); }
      catch { return { judge: "钟离", raw: p4Response.content }; }
    })());
  }
}

// ════════════════════════════════════════════════════════
// §11 Phase 5: 霜凝 — 方向监理
// ════════════════════════════════════════════════════════
if (!budgetOk()) {
  console.log("  跳过 Phase 5（预算不足）");
} else {
  const verdictData = readJson("verdict-analysis.json");
  const zhongliData = readJson("zhongli-strategy.json");

  const p5Start = Date.now();
  const p5Response = await callLlm(reasonerAdapter, REASONER_MODEL, [
    {
      role: "system",
      content: [
        "你是霜凝，超越者，方向监理。你的职责是：",
        "站在审视流程之外，评估审视本身的完整性和方向。",
        "",
        "## 任务",
        "1. 读取纳西妲的裁决 + 钟离的战略过滤",
        "2. 判断本次审视遗漏了什么方向（哪些层面没有覆盖到）",
        "3. 建议下次应该增加哪类检查（新的 Agent 类型或新的扫描维度）",
        "4. 指出当前流程哪个环节最弱（最需要改进）",
        "5. 评估 6 个出证 Agent 的覆盖完整性",
        "",
        "## 方向问题举例",
        "- 性能测试被遗漏了吗？",
        "- 安全审计有缺失吗？",
        "- 文档/配置变动是否被忽略了？",
        "- 跨包依赖的影响是否充分评估？",
        "",
        "只输出 JSON，不写散文。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "# 纳西妲裁决",
        verdictData ? JSON.stringify(verdictData, null, 2) : "(裁决文件缺失)",
        "",
        "# 钟离战略过滤",
        zhongliData ? JSON.stringify(zhongliData, null, 2) : "(策略文件缺失)",
        "",
        "## 输出格式",
        "输出 JSON 到 test-output/self-examination-soft/shuangning-direction.json，格式如下：",
        JSON.stringify({
          judge: "霜凝",
          blindSpots: ["本次未覆盖的方向"],
          futureChecks: ["下次应增加的检查类型"],
          weakestLink: "当前流程最弱的环节及原因",
          agentCoverage: {
            covered: ["已覆盖的领域"],
            missing: ["未覆盖的领域"],
            score: 0.0,
          },
        }, null, 2),
      ].join("\n"),
    },
  ]);

  const p5Elapsed = ((Date.now() - p5Start) / 1000).toFixed(0);
  console.log(`Phase 5 霜凝方向监理: ✅ ⏱ ${p5Elapsed}s (tokens: ${p5Response.tokens})`);

  if (p5Response.content) {
    writeJson("shuangning-direction.json", (() => {
      try { return JSON.parse(p5Response.content); }
      catch { return { judge: "霜凝", raw: p5Response.content }; }
    })());
  }
}

// ════════════════════════════════════════════════════════
// §12 Phase 6: 凝光合成最终报告（参考裁决 + 钟离 + 霜凝 三份判定）
// ════════════════════════════════════════════════════════
if (!budgetOk()) {
  console.log("  跳过 Phase 6（预算不足）");
} else {
  const verdictData = readJson("verdict-analysis.json");
  const zhongliData = readJson("zhongli-strategy.json");
  const shuangningData = readJson("shuangning-direction.json");

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

  const p6Start = Date.now();
  const p6Response = await callLlm(reasonerAdapter, REASONER_MODEL, [
    {
      role: "system",
      content: [
        "你是凝光，Cortex 门下省首席合成官。你的职责是：",
        "基于纳西妲的裁决、钟离的战略过滤、霜凝的方向监理，合成最终修复建议报告。",
        "这是唯一的散文输出——之前的全部阶段都是结构化 JSON。",
        "",
        "## 报告结构",
        "1. 执行摘要（2-3 句概述）",
        "2. 幸存 Claims（纳西妲确认的问题，按 P0/P1/P2 优先级排序）",
        "3. 被推翻 Claims（说明为什么被推翻）",
        "4. 契约风险提醒（钟离视角的易碎点）",
        "5. 流程改进建议（霜凝发现的盲区）",
        "6. 修复建议（按优先级分组，含风险提示）",
        "7. 攻防摘要（哪些攻击最有力，哪些防御最薄弱）",
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
        "# 钟离战略过滤",
        zhongliData ? JSON.stringify(zhongliData, null, 2) : "(策略文件缺失)",
        "",
        "# 霜凝方向监理",
        shuangningData ? JSON.stringify(shuangningData, null, 2) : "(方向文件缺失)",
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

  const p6Elapsed = ((Date.now() - p6Start) / 1000).toFixed(0);
  console.log(`Phase 6 凝光合成: ✅ ⏱ ${p6Elapsed}s (tokens: ${p6Response.tokens})`);

  if (p6Response.content) {
    fs.writeFileSync(path.join(OUTPUT, "final-report.md"), p6Response.content!, "utf-8");
  }
}

// ════════════════════════════════════════════════════════
// §13 Phase 7 (future): 昔涟终裁（预留，不执行）
// ════════════════════════════════════════════════════════
// 启用条件: cyrene-memory.db 存在且包含 >= 2 次自审视记录
// 功能: 对照历史记忆，识别重复出现的问题、趋势变化
// 产出: cyrene-legacy.json
//
// 昔涟终裁将在未来版本中激活。届时流程为：
//   1. 读取当前全部产出（裁决 + 钟离 + 霜凝 + 凝光报告）
//   2. 查询 cyrene-memory.db 查找历史审视记录
//   3. 识别重复出现的问题、改善趋势、新增风险
//   4. 输出 cyrene-legacy.json 供后续审视对比

// ════════════════════════════════════════════════════════
// §14 汇总
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
// §15 清理
// ════════════════════════════════════════════════════════
console.log = originalConsoleLog;
try { await engine.memory?.close?.(); } catch {}
