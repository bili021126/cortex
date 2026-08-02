/**
 * @e2e: fcall-stability
 * @covers: DeepSeek function calling 稳定性
 * @cost: ~0.5元/次
 * @overlap: 无（新维度验证）
 *
 * 验证修复后的 DeepSeek function calling 在各种 Agent 类型上都能正常工作。
 * 对每种主要 Agent 类型跑一个简单 task，统计 function calling 成功率。
 *
 * 用法: npx tsx packages/engine/tests/manual/e2e/fcall-stability.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 */

import * as path from "node:path";
import { bootstrapEngine, type BootstrapEngineResult } from "@cortex/engine";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "@cortex/platform";
import type { TaskNode , EmittableEvent } from "@cortex/shared";
import { findProjectRoot, loadEnv } from "./e2e-utils.js";

// ════════════════════════════════════════════════
// §0 引导
// ════════════════════════════════════════════════

const ROOT = findProjectRoot();
const ORIGINAL_LOG = console.log;

loadEnv(ROOT);

const API_KEY = process.env.DEEPSEEK_API_KEY!;
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-v4-flash";
const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? CHAT_MODEL;

const llm = new LlmAdapter({ apiKey: API_KEY, baseUrl: BASE_URL, chatModel: CHAT_MODEL });
const toolkit = new Toolkit();
toolkit.setWorkspaceRoot(ROOT);

const llms = new Map<string, LlmAdapter>();
llms.set("DEEPSEEK_CHAT", llm);
if (CHAT_MODEL !== REASONER_MODEL) {
  const reasoner = new LlmAdapter({ apiKey: API_KEY, baseUrl: BASE_URL, chatModel: REASONER_MODEL });
  llms.set("DEEPSEEK_REASONER", reasoner);
} else {
  llms.set("DEEPSEEK_REASONER", llm);
}

// ════════════════════════════════════════════════
// §1 Bootstrap 引擎
// ════════════════════════════════════════════════

const dbPath = path.join(ROOT, ".cortex", "test", "fcall-stability.db");
try { require("fs").unlinkSync(dbPath); } catch {}
try { require("fs").unlinkSync(dbPath + "-wal"); } catch {}
try { require("fs").unlinkSync(dbPath + "-shm"); } catch {}

const engine: BootstrapEngineResult = await bootstrapEngine(ROOT, {
  llms,
  toolkit,
  dbPath,
});

// 绕过 ConfirmGate——E2E 无需人工确认
toolkit.setGate?.(engine.gate);
engine.gate?.setBridge?.({
  confirm: async (req: any) => ({ requestId: req.id, approved: true }),
  getPlatformContext: (() => ({})) as any,
    notify: (_msg: string) => {},
});

// ════════════════════════════════════════════════
// §2 Agent 类型覆盖测试
// ════════════════════════════════════════════════

interface AgentTestDef {
  type: string;
  name: string;
  payload: string;
}

const AGENT_TESTS: AgentTestDef[] = [
  { type: "code",       name: "阿贝多",  payload: "列出当前工作目录的顶层文件，用 list_files 工具完成" },
  { type: "review",     name: "刻晴",    payload: "读取 packages/engine/tests/manual/e2e/ 目录下一个 .ts 文件，审查其代码结构" },
  { type: "analysis",   name: "纳西妲",  payload: "分析 packages/engine/src/core/ 的模块结构，列出关键发现" },
  { type: "ops",        name: "北斗",    payload: "用 run_shell 执行 dir /b packages\\engine\\src\\core，报告结果" },
  { type: "loop",       name: "莫娜",    payload: "扫描当前工作目录，用 list_files 采集顶层 .ts 文件列表" },
  { type: "inspector",  name: "安柏",    payload: "用 list_files 统计 packages/engine/tests/manual/e2e/ 下所有 .ts 文件的数量" },
];

function makeNode(def: AgentTestDef): TaskNode {
  return {
    id: `fcall-${def.type}-${Date.now()}`,
    type: def.type,
    tags: [def.type] as any,
    payload: def.payload,
    status: "pending" as const,
    claimedBy: [],
    results: [],
    createdAt: Date.now(),
  };
}

// ════════════════════════════════════════════════
// §3 执行
// ════════════════════════════════════════════════

const stats = { total: 0, success: 0, errors: [] as string[] };

for (const at of AGENT_TESTS) {
  try {
    ORIGINAL_LOG(`\n▶ ${at.name} (${at.type})`);
    const node = makeNode(at);
    engine.board.addNode(node);
    const report = await engine.scheduler.executeAll();
    stats.total++;
    if (report.failed === 0) stats.success++;
    ORIGINAL_LOG(`  ${at.type}: ${report.failed === 0 ? "✅" : "❌"} completed=${report.completed} failed=${report.failed}`);
  } catch (e: any) {
    stats.total++;
    stats.errors.push(`${at.type}: ${String(e).slice(0, 100)}`);
    ORIGINAL_LOG(`  ${at.type}: ❌ ${String(e).slice(0, 80)}`);
  }
}

// ════════════════════════════════════════════════
// §4 汇总
// ════════════════════════════════════════════════

const pct = stats.total > 0 ? Math.round(stats.success / stats.total * 100) : 0;
ORIGINAL_LOG(`\nfcall 稳定性: ${stats.success}/${stats.total} (${pct}%)`);
if (stats.errors.length > 0) {
  ORIGINAL_LOG("错误:");
  stats.errors.forEach(e => ORIGINAL_LOG(`  ${e}`));
}
ORIGINAL_LOG(stats.success >= stats.total * 0.8 ? "✅ PASSED" : "❌ FAILED");

// ════════════════════════════════════════════════
// §5 清理
// ════════════════════════════════════════════════

try { await engine.memory?.close?.(); } catch {}
try { await engine.shutdown?.(); } catch {}
