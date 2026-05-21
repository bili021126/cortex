/**
 * BrowserAgent 独立验证 —— 宵宫的第一场烟花
 *
 * 用法: npx tsx tests/manual/browser-e2e.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 测试内容：
 *   1. 宵宫用 Playwright 打开 webui/test.html
 *   2. 输入表达式 "2+3"
 *   3. 点击计算按钮
 *   4. 读取结果，验证是否为 "结果:5"
 *
 * 这是纯粹的 BrowserAgent 独立验证——不涉及其他 Agent，不涉及协作。
 * 只验证一条链路：LLM理解任务 →调用browser_do工具 →Playwright真实操作浏览器 →返回结果。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType, PipelinePriority, type TaskNode } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import {
  TaskBoard,
  AgentPool,
  createBrowserAgent,
  Scheduler,
  PipelineObserver,
  ConfirmGate,
  Toolkit,
  MemoryStore,
  MetaAgent,
} from "@cortex/engine";
import { resolveLlmConfig } from "../config/llm-defaults";

// ═══════════════════════════════════════════════
// 1. 环境变量
// ═══════════════════════════════════════════════

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.error("❌ .env 文件不存在");
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
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) { console.error("❌ DEEPSEEK_API_KEY 未设置"); process.exit(1); }

  const llmCfg = resolveLlmConfig();
  const BASE_URL = llmCfg.baseUrl;
  const CHAT_MODEL = llmCfg.chatModel;
  const REASONER_MODEL = llmCfg.reasonerModel;
  const WORKSPACE = path.resolve(process.cwd(), "../.."); // 项目根目录 (d:\cortex)

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  🎆 宵宫 BrowserAgent 独立验证                    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  测试页面: webui/test.html`);
  console.log(`  工作区:   ${WORKSPACE}`);
  console.log(`  Model:    ${CHAT_MODEL}`);
  console.log(`  Base:     ${BASE_URL}\n`);

  // ── 初始化组件 ──
  console.log("🟢 [Phase 1] 初始化组件...");

  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    reasonerModel: REASONER_MODEL,
    reasoningEffort: llmCfg.reasoningEffort as "high" | "max",
  });
  adapter.setCacheEnabled(true);

  const metaAgent = new MetaAgent(adapter);
  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();
  const gate = new ConfirmGate();
  gate.bypassAll();

  const memory = new MemoryStore();
  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-browser.db");
  await memory.init(MEMORY_DB);

  // ── Agent 池注册 ──
  pool.register({ type: AgentType.Browser, maxInstances: 1 });
  const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

  // ── 注册 BrowserAgent ──
  console.log("🟢 [Phase 2] 注册 BrowserAgent —— 宵宫...");

  const browserToolkit = new Toolkit(gate);
  const browserAgent = createBrowserAgent(adapter, browserToolkit, memory);
  browserAgent.setWorkspaceRoot(WORKSPACE);
  await browserAgent.wakeup();
  scheduler.register(AgentType.Browser, browserAgent, CHAT_MODEL);
  console.log("   ✅ 宵宫就绪 · 烟花准备点火 🎆\n");

  // ── 事件监听 ──
  observer.on(PipelinePriority.HIGH, (e) => {
    const payload = e.payload as any;
    const nodeId = payload?.nodeId ?? "";
    const snippet = JSON.stringify(payload).slice(0, 120);
    console.log(`   📡 ${e.type}: ${nodeId ? nodeId : snippet}`);
  });
  // 同时监听低优先级事件（调试用）
  observer.on(PipelinePriority.NORMAL, (e) => {
    const payload = e.payload as any;
    console.log(`   🔍 [DEBUG] ${e.type}: ${JSON.stringify(payload).slice(0, 150)}`);
  });

  // ── 构建单个验证任务 ──
  console.log("🟢 [Phase 3] 构建验证任务...");

  const testPagePath = path.join(WORKSPACE, "webui", "test.html");
  const fileUrl = `file:///${testPagePath.replace(/\\/g, "/")}`;

  const now = Date.now();
  const task: TaskNode = {
    id: "browser-verify-1",
    type: "browser",
    tags: ["browser", "ui_verify"],
    needsMultiPerspective: false,
    claimedBy: [],
    payload: [
      "打开计算器页面，输入 2+3，点击计算，验证结果是否为 5",
      "",
      `页面 URL: ${fileUrl}`,
      `输入框: #expression，输入 "2+3"`,
      `按钮: #calculateBtn`,
      `结果元素: #result，预期文本 "结果:5"`,
    ].join("\n"),
    status: "pending",
    results: [],
    createdAt: now,
  };

  board.addNode(task);
  console.log(`   ✅ 1 个验证节点入板: ${task.id}\n`);

  // ── 执行 ──
  console.log("🟢 [Phase 4] 宵宫开始验证...\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const execStart = Date.now();
  const report = await scheduler.executeAll();
  const execDuration = Date.now() - execStart;

  // ── 结果 ──
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  📊 验证结果                                     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`   完成: ${report.completed}  失败: ${report.failed}  耗时: ${execDuration}ms`);
  console.log();

  const allNodes = board.getAllNodes();
  for (const n of allNodes) {
    const status = n.status === "done" ? "✅" : n.status === "failed" ? "❌" : "⏳";
    console.log(`   ${status} [${n.type}] ${n.id} (${n.status})`);
    for (const r of n.results) {
      const preview = (r.output ?? r.error ?? "?").slice(0, 300);
      console.log(`      ${r.success ? "✅" : "❌"} ${preview}`);
    }
  }
  console.log();

  // ── 清理 ──
  await browserAgent.shutdown();
  console.log(`   全流程耗时: ${execDuration}ms`);
  console.log("   🎆 宵宫收工，烟花燃放完毕！\n");
}

main().catch((err) => {
  console.error("❌ BrowserAgent 验证失败:", err);
  process.exit(1);
});
