/**
 * 圆桌对话 —— 自审视共识会议 · 强约束版本（第二轮）
 *
 * 用法: npx tsx packages/engine/tests/manual/scripts/conversation-11.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 背景：Cortex 首轮修复验证审视（2026-05-04）产出了 7 份验证报告。
 * 本次圆桌召集审视委员会，对修复后的代码实况进行交叉讨论，
 * 产出更新版共识修复清单——标注已闭合/仍需投入/新浮现的问题。
 *
 * Persona 定义与会议引擎见 roundtable-config.ts
 * 基于 MemoryStore 共享记忆——先读别人说了什么，再决定自己要不要说。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { AgentType } from "@cortex/shared";
import { LlmAdapter } from "../../../src/llm-adapter";
import { SHENSHI_CONFIG, runMeeting } from "../config/roundtable-config";
import { loadAuditContext, enhancePersonasWithAudit, printAuditSummary } from "../config/audit-loader";
import personaPrompts from "../config/persona-prompts.json" assert { type: "json" };
import type { MeetingConfig } from "../config/roundtable-config";

// ═══════════════════════════════════════════════
// ENV
// ═══════════════════════════════════════════════

function loadEnv() {
  const p = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(p)) { console.error(".env 缺失"); process.exit(1); }
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const m = line.replace(/\r$/, "").match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

// ═══════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════

async function main() {
  // Windows 终端 UTF-8 显示修复：chcp 操作控制台句柄，跨进程生效
  if (process.platform === "win32") {
    try { execSync("chcp 65001", { stdio: "pipe" }); } catch { /* 静默 */ }
  }

  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY!;
  const BASE = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-reasoner";
  const REASONER = process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-v4-pro";

  // 使用 import.meta.url 推导项目根目录，避免 cd 到不同目录导致路径解析错误
  const __filename = fileURLToPath(import.meta.url);
  const SCRIPTS_DIR = path.dirname(__filename);                        // .../tests/manual/scripts
  const ROOT = path.resolve(SCRIPTS_DIR, "..", "..", "..", "..", ".."); // d:\cortex

  const DB_DIR = path.join(ROOT, ".cortex");
  const CONSENSUS_OUTPUT = path.join(ROOT, "test-output", "self-examination", "consensus-fix-list.md");

  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  const adapter = new LlmAdapter({
    apiKey: API_KEY, baseUrl: BASE,
    chatModel: CHAT, reasonerModel: REASONER,
    reasoningEffort: "high",
  });
  adapter.setCacheEnabled(true);
  adapter.setCacheMode("fingerprint");

  const CACHE_FILE = path.join(DB_DIR, ".llm-cache.json");
  if (fs.existsSync(CACHE_FILE)) {
    const cacheJson = fs.readFileSync(CACHE_FILE, "utf-8");
    adapter.loadCache(cacheJson);
    console.log(`📦 加载缓存: ${adapter.cacheSize} 条`);
  }

  // ══ 动态加载审计报告，注入最新验证数据到 Persona 提示词 ══
  const AUDIT_DIR = path.join(ROOT, "test-output", "self-examination");
  const auditCtx = loadAuditContext(AUDIT_DIR);
  printAuditSummary(auditCtx);

  // 用最新审计数据增强 Persona systemPrompts
  const enhancedPersonas = enhancePersonasWithAudit(personaPrompts as unknown as Record<string, { emoji: string; name: string; title: string; systemPrompt: string }>, auditCtx);
  const enhancedConfig: MeetingConfig = {
    ...SHENSHI_CONFIG,
    personas: enhancedPersonas.map((p, i) => ({
      type: SHENSHI_CONFIG.personas[i]?.type ?? AgentType.Code,
      ...p,
    })),
  };

  await runMeeting(enhancedConfig, adapter, CHAT, DB_DIR, CONSENSUS_OUTPUT);
  console.log(`完成  |  缓存命中: ${adapter.cacheStats.hits}/${adapter.cacheStats.hits + adapter.cacheStats.misses} (${adapter.cacheStats.rate})  |  缓存条目: ${adapter.cacheSize}`);
  fs.writeFileSync(CACHE_FILE, adapter.saveCache(), "utf-8");
}

main().catch((e) => { console.error("圆桌会议异常终止", e); process.exit(1); });
