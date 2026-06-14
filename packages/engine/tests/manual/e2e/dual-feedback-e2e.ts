/**
 * 双向下放全链路 E2E —— 真实 LLM 验证 Pipeline→MetaAgent + sessionId 锚定
 *
 * 用法: npx tsx tests/manual/e2e/dual-feedback-e2e.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验证链路（v2.5.41 宪法修订核心）:
 *   1. MetaAgent 经 PipelineObserver 订阅 NodeComplete/NodeFailed 事件
 *   2. Scheduler.executeAll() → MemoryStore.beginSession/endSession 生命周期
 *   3. sessionId 在 ExecutionReport ↔ MemoryEntry 中一致锚定
 *   4. getBySession() 可查询当前 run 的全部记忆
 *   5. endSession() 后 sessionId 清除 + Pending 记忆湮灭
 *   6. 第二轮 plan() 可接收第一轮管线上下文（间接验证）
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType, PipelinePriority, PipelineEventType, type TaskNode, type Tag } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import {
  MetaAgent,
  TaskBoard,
  AgentPool,
  Scheduler,
  PipelineObserver,
  ConfirmGate,
  createAgent,
  codeAgentConfig,
  createInspectorAgent,
} from "@cortex/engine";
import { Toolkit } from "@cortex/platform";
import { MemoryStore } from "@cortex/memory-store";
import { resolveLlmConfig } from "../config/llm-defaults";

// ═══════════════════════════════════════════════
// 0. 环境变量
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
// 1. 只读工具（限定 .cortex/e2e-output/ 写入）
// ═══════════════════════════════════════════════

function registerReadOnlyTools(toolkit: Toolkit, workspaceRoot: string) {
  const resolve = (p: string) => path.resolve(workspaceRoot, p);

  toolkit.register("read_file", async (params: any) => {
    const fp = resolve(params.file_path as string);
    if (!fs.existsSync(fp)) return { success: false, error: `File not found: ${fp}` };
    try {
      return { success: true, output: fs.readFileSync(fp, "utf-8") };
    } catch (e) { return { success: false, error: String(e) }; }
  });

  toolkit.register("list_files", async (params: any) => {
    const dirPath = resolve((params.dir_path ?? ".") as string);
    if (!fs.existsSync(dirPath)) return { success: false, error: `Directory not found: ${dirPath}` };
    try {
      const results: string[] = [];
      const walk = (d: string, depth: number) => {
        if (depth > 3) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.name.startsWith(".")) continue;
          const full = path.join(d, e.name);
          if (e.isDirectory()) { results.push(full + "/"); walk(full, depth + 1); }
          else results.push(full);
        }
      };
      walk(dirPath, 0);
      return { success: true, output: results.slice(0, 30).join("\n") || "(empty)" };
    } catch (e) { return { success: false, error: String(e) }; }
  });

  toolkit.register("search_code", async (params: any) => {
    const dir = resolve((params.dir_path ?? ".") as string);
    const pattern = (params.pattern ?? "") as string;
    if (!pattern) return { success: false, error: "search_code: 缺少 pattern" };
    try {
      const results: string[] = [];
      const walk = (d: string, depth: number) => {
        if (depth > 2) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.name.startsWith(".") || e.name === "node_modules") continue;
          const full = path.join(d, e.name);
          if (e.isDirectory()) walk(full, depth + 1);
          else if (/\.(ts|js|json|md)$/.test(e.name)) {
            try {
              const content = fs.readFileSync(full, "utf-8");
              if (content.includes(pattern)) results.push(full);
            } catch { /* skip */ }
          }
        }
      };
      walk(dir, 0);
      return { success: true, output: results.slice(0, 15).join("\n") || "(no matches)" };
    } catch (e) { return { success: false, error: String(e) }; }
  });

  toolkit.register("write_file", async (params: any) => {
    const fp = resolve(params.file_path as string);
    const outputDir = path.resolve(workspaceRoot, ".cortex", "e2e-output");
    if (!fp.startsWith(outputDir + path.sep)) {
      return { success: false, error: `write_file denied: 只能写入 .cortex/e2e-output/` };
    }
    // 兼容多种参数名：content / content_blob / text / data
    const content = params.content ?? params.content_blob ?? params.text ?? params.data;
    const contentStr = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    try {
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fp, contentStr, "utf-8");
      return { success: true, output: `Wrote file: ${fp}` };
    } catch (e) { return { success: false, error: String(e) }; }
  });
}

// ═══════════════════════════════════════════════
// 2. 事件收集器——验证管线事件流转
// ═══════════════════════════════════════════════

interface CollectedEvent {
  type: string;
  priority: number;
  payload: Record<string, unknown>;
  timestamp: number;
}

class EventCollector {
  events: CollectedEvent[] = [];

  collect(observer: PipelineObserver): void {
    // 登记所有优先级的事件，验证 MetaAgent 的 HIGH/CRITICAL 订阅确实触发
    observer.on(PipelinePriority.HIGH, (e) => {
      this.events.push({ type: e.type, priority: e.priority, payload: (e.payload ?? {}) as Record<string, unknown>, timestamp: e.timestamp });
    });
    observer.on(PipelinePriority.CRITICAL, (e) => {
      this.events.push({ type: e.type, priority: e.priority, payload: (e.payload ?? {}) as Record<string, unknown>, timestamp: e.timestamp });
    });
    observer.on(PipelinePriority.NORMAL, (e) => {
      this.events.push({ type: e.type, priority: e.priority, payload: (e.payload ?? {}) as Record<string, unknown>, timestamp: e.timestamp });
    });
  }

  get nodeCompletes(): CollectedEvent[] {
    return this.events.filter((e) => e.type === PipelineEventType.NodeComplete);
  }

  get nodeFailures(): CollectedEvent[] {
    return this.events.filter((e) => e.type === PipelineEventType.NodeFailed);
  }

  get schedulerDones(): CollectedEvent[] {
    return this.events.filter((e) => e.type === PipelineEventType.SchedulerDone);
  }
}

// ═══════════════════════════════════════════════
// 3. 断言工具
// ═══════════════════════════════════════════════

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`   ✅ ${label}`); passed++; }
  else { console.error(`   ❌ ${label}`); failed++; }
}

// ═══════════════════════════════════════════════
// 4. 主流程
// ═══════════════════════════════════════════════

async function main() {
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) { console.error("❌ DEEPSEEK_API_KEY 未设置"); process.exit(1); }

  const llmCfg = resolveLlmConfig();
  const BASE_URL = llmCfg.baseUrl;
  const CHAT_MODEL = llmCfg.chatModel;
  const REASONER_MODEL = llmCfg.reasonerModel;
  const WORKSPACE = process.cwd();

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  双向下放全链路 E2E —— v2.5.41 宪法修订验证    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  Chat:    ${CHAT_MODEL}`);
  console.log(`  Reasoner:${REASONER_MODEL}`);
  console.log(`  CWD:     ${WORKSPACE}\n`);

  // ── 4a. 初始化组件 ──
  console.log("🟢 [Phase 1] 初始化组件...");

  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    reasonerModel: REASONER_MODEL,
    reasoningEffort: llmCfg.reasoningEffort as "high" | "max",
  });
  adapter.setCacheEnabled(true);

  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();
  const gate = new ConfirmGate();
  gate.bypassAll();
  const memory = new MemoryStore();
  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "dual-feedback-memory.db");
  // 清理旧 DB，确保每次 E2E 从零开始（避免跨 run 残留数据干扰 sessionId 验证）
  if (fs.existsSync(MEMORY_DB)) {
    fs.unlinkSync(MEMORY_DB);
    try { fs.unlinkSync(MEMORY_DB + "-wal"); } catch { /* 可能不存在 */ }
    try { fs.unlinkSync(MEMORY_DB + "-shm"); } catch { /* 可能不存在 */ }
  }
  await memory.init(MEMORY_DB);
  console.log(`   ✅ MemoryStore 持久化: ${MEMORY_DB} (已清理旧数据)`);

  // ── 关键：MetaAgent 注入 observer（v2.5.41 新增）──
  const eventCollector = new EventCollector();
  eventCollector.collect(observer);
  const metaAgent = new MetaAgent(adapter, undefined, undefined, undefined, observer);
  console.log("   ✅ MetaAgent 已注入 PipelineObserver");

  pool.register({ type: AgentType.Code, maxInstances: 3 });
  pool.register({ type: AgentType.Inspector, maxInstances: 3 });

  const scheduler = new Scheduler(board, pool, observer, metaAgent);
  // ── 关键：Scheduler 接线 MemoryStore（v2.5.41 新增）──
  scheduler.setMemoryStore(memory);
  console.log("   ✅ Scheduler.setMemoryStore() 已接线");

  // ── 4b. 注册 Agent ──
  console.log("\n🟢 [Phase 2] 注册 Agent...");

  const codeToolkit = new Toolkit(gate);
  registerReadOnlyTools(codeToolkit, WORKSPACE);
  const codeAgent = createAgent(codeAgentConfig("code"), adapter, codeToolkit, memory);
  await codeAgent.wakeup();
  scheduler.register(AgentType.Code, codeAgent, CHAT_MODEL);
  console.log("   ✅ CodeAgent");

  const inspectorToolkit = new Toolkit(gate);
  registerReadOnlyTools(inspectorToolkit, WORKSPACE);
  const inspectorAgent = createInspectorAgent(adapter, inspectorToolkit, memory);
  await inspectorAgent.wakeup();
  scheduler.register(AgentType.Inspector, inspectorAgent, CHAT_MODEL);
  console.log("   ✅ InspectorAgent\n");

  // ═══════════════════════════════════════════════════
  // 测试 1: 第一轮 executeAll — sessionId 生命周期
  // ═══════════════════════════════════════════════════
  console.log("🟢 [Test 1] metaAgent.plan() → executeAll() → sessionId 锚定");

  const intent1 = [
    "⚠️ 轻量输出：只读 packages/engine/src/core/scheduler.ts 前50行，写一份简要摘要到 .cortex/e2e-output/scheduler-summary.md。不要修改任何现有代码。",
  ].join("\n");

  const nodes1 = await metaAgent.plan(intent1);
  console.log(`   MetaAgent 产出 ${nodes1.length} 个节点`);
  for (const n of nodes1) {
    board.addNode(n);
  }

  // 验证：sessionId 在 executeAll 前为 undefined
  assert(memory.sessionId === undefined, "executeAll 前 memory.sessionId === undefined");

  const report = await scheduler.executeAll();
  console.log(`   executeAll 完成: ${report.completed}/${report.totalNodes} completed, ${report.durationMs}ms`);

  // ── 断言块 ──
  console.log("\n── 断言验证 ──");
  assert(typeof report.sessionId === "string" && report.sessionId!.length > 0,
    `ExecutionReport.sessionId 非空: "${report.sessionId}"`);
  assert(report.sessionId!.startsWith("run-"),
    `sessionId 以 "run-" 开头: ${report.sessionId}`);

  // sessionId 锚定：report ← → memory
  const memSessionId = memory.sessionId;
  // 注意：endSession() 在 executeAll 末尾已调用，sessionId 可能已被清除
  assert(memSessionId === undefined,
    `endSession() 后 memory.sessionId 已清除: ${memSessionId}`);

  // getBySession：按 report.sessionId 查询记忆
  const runMemories = memory.getBySession(report.sessionId!);
  console.log(`   getBySession("${report.sessionId}") → ${runMemories.length} 条记忆`);
  assert(runMemories.length > 0,
    `getBySession() 可查询到本次 run 的记忆（${runMemories.length} 条）`);
  if (runMemories.length > 0) {
    for (const m of runMemories.slice(0, 3)) {
      console.log(`     [${m.kind}] ${m.summary.slice(0, 60)}... sessionId=${m.sessionId}`);
    }
    assert(runMemories.every((m) => m.sessionId === report.sessionId),
      "所有 run 记忆的 sessionId 与 ExecutionReport.sessionId 一致");
  }

  // 管线事件：验证 NodeComplete 事件被发射（MetaAgent 订阅了 HIGH/CRITICAL）
  const nodeCompletes = eventCollector.nodeCompletes;
  console.log(`   管线 NodeComplete 事件: ${nodeCompletes.length} 个`);
  assert(nodeCompletes.length > 0,
    `至少 1 个 NodeComplete 事件被发射（MetaAgent 在 HIGH 优先级订阅）`);

  const schedulerDones = eventCollector.schedulerDones;
  assert(schedulerDones.length === 1,
    `恰好 1 个 SchedulerDone 事件: ${schedulerDones.length}`);

  // ═══════════════════════════════════════════════════
  // 测试 2: 第二轮 executeAll — 管线上下文积累
  // ═══════════════════════════════════════════════════
  console.log("\n🟢 [Test 2] 第二轮 executeAll → 管线上下文积累 + sessionId 隔离");

  const board2 = new TaskBoard();
  const pool2 = new AgentPool();
  pool2.register({ type: AgentType.Code, maxInstances: 3 });
  pool2.register({ type: AgentType.Inspector, maxInstances: 3 });
  const scheduler2 = new Scheduler(board2, pool2, observer, metaAgent);
  scheduler2.setMemoryStore(memory);
  // ⚠️ 关键修复：scheduler2 必须注册 Agent（上一版遗漏，导致 0/1 completed）
  scheduler2.register(AgentType.Code, codeAgent, CHAT_MODEL);
  scheduler2.register(AgentType.Inspector, inspectorAgent, CHAT_MODEL);
  console.log("   ✅ scheduler2 Agent 已注册");

  const intent2 = [
    "⚠️ 轻量：读 .cortex/e2e-output/scheduler-summary.md 验证它存在，列出内容前 3 行。",
  ].join("\n");

  const nodes2 = await metaAgent.plan(intent2);
  assert(nodes2.length > 0, `第二轮 plan() 产出 ${nodes2.length} 个节点`);
  for (const n of nodes2) {
    board2.addNode(n);
  }

  const priorEventCount = eventCollector.events.length;
  const report2 = await scheduler2.executeAll();
  console.log(`   executeAll 完成: ${report2.completed}/${report2.totalNodes} completed, ${report2.durationMs}ms`);
  const newEventCount = eventCollector.events.length - priorEventCount;

  // 断言块
  console.log("\n── 断言验证 ──");
  assert(typeof report2.sessionId === "string" && report2.sessionId!.length > 0,
    `第二轮 sessionId 非空: "${report2.sessionId}"`);
  assert(report2.sessionId !== report.sessionId,
    `两轮 sessionId 不同（隔离）: "${report.sessionId}" vs "${report2.sessionId}"`);

  // 第二轮管线的 NodeComplete 事件
  const round2Completes = eventCollector.events.slice(priorEventCount)
    .filter((e) => e.type === PipelineEventType.NodeComplete);
  console.log(`   第二轮 NodeComplete 事件: ${round2Completes.length} 个`);
  assert(round2Completes.length > 0,
    `第二轮至少 1 个 NodeComplete（MetaAgent HIGH 订阅验证）`);

  // 第二轮记忆隔离
  const round2Memories = memory.getBySession(report2.sessionId!);
  console.log(`   第二轮 getBySession → ${round2Memories.length} 条记忆`);
  assert(round2Memories.every((m) => m.sessionId === report2.sessionId),
    "第二轮记忆的 sessionId 与本轮 report 一致");

  // 验证两轮记忆不混淆
  const round1MemoriesCheck = memory.getBySession(report.sessionId!);
  const round2Ids = new Set(round2Memories.map((m) => m.id));
  const crossContamination = round1MemoriesCheck.some((m) => round2Ids.has(m.id));
  assert(!crossContamination || round1MemoriesCheck.length === 0 || round2Memories.length === 0,
    `两轮记忆无交叉污染（或某轮未产生记忆）`);

  // ═══════════════════════════════════════════════════
  // 结果汇总
  // ═══════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log(`║  结果: ${passed} passed / ${failed} failed                              ║`);
  if (failed === 0) {
    console.log("║  🎉 双向下放全链路验证通过！                      ║");
  } else {
    console.log("║  ⚠️  存在失败，请检查上述 ❌ 条目                  ║");
  }
  console.log("╚══════════════════════════════════════════════════╝");

  // 清理
  await memory.close();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("💥 E2E 崩溃:", err);
  process.exit(2);
});
