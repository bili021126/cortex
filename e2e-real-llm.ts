/**
 * WebUI è®¡ç®å¨ç³»ï¿½?âï¿½?MetaAgent èªè§ï¿½?+ å®µå®«éªè¯ E2E
 *
 * ç¨æ³: npx tsx tests/manual/webui-calculator-e2e.ts
 * åæ: é¡¹ç®æ ¹ç®ï¿½?.env å·²éï¿½?DEEPSEEK_API_KEY
 *
 * åºæ¯ï¼çé¨ï¼MetaAgentï¼æ¥æ¶ç¨æ·æï¿½?ï¿½?èªè§åä»»å¡æ  ï¿½?é¿è´å¤ååç«¯ ï¿½?
 *       å®µå®«ï¼BrowserAgentï¼ç¨çå®æµè§å¨éªï¿½?ï¿½?å®æå¤æ¥ ï¿½?å»æ´å®¡æ¥
 *
 * ï¿½?calculator-e2e.ts çæ ¸å¿å·®å¼ï¼
 *   - ä¸ç¨ç¡¬ç¼ç èç¹ï¼ï¿½?MetaAgent.plan() èªå·±æè§£æå¾
 *   - BrowserAgentï¼å®µå®«ï¼ï¿½?Playwright æä½çå®æµè§ï¿½?
 *   - éªè¯ WebUI èé CLI è®¡ç®ï¿½?
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType, MemoryType, LinkType, PipelinePriority, type TaskNode } from "@cortex/shared";
import { AgentStatus as AS } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { TaskBoard } from "../../../src/task-board";
import { AgentPool } from "../../../src/agent-pool";
import { CodeAgent } from "../../../src/agents/code-agent";
import { ReviewAgent } from "../../../src/agents/review-agent";
import { InspectorAgent } from "../../../src/agents/inspector-agent";
import { BrowserAgent } from "../../../src/agents/browser-agent";
import { AnalysisAgent } from "../../../src/agents/analysis-agent";
import { DocGovernAgent } from "../../../src/agents/doc-govern-agent";
import { LoopAgent } from "../../../src/agents/loop-agent";
import { OpsAgent } from "../../../src/agents/ops-agent";
import { Scheduler } from "../../../src/scheduler";
import { PipelineObserver } from "../../../src/pipeline-observer";
import { ConfirmGate } from "../../../src/confirm-gate";
import { Toolkit } from "../../../src/toolkit";
import { MemoryStore } from "../../../src/memory-store";
import { MetaAgent } from "../../../src/meta-agent";

// ââââââââââââââââââââââââââââââââââââââââââââââï¿½?
// 1. ç¯å¢åé
// ââââââââââââââââââââââââââââââââââââââââââââââï¿½?

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.error("ï¿½?.env æä»¶ä¸å­ï¿½?);
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const clean = line.replace(/\r$/, "");
    const m = clean.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

// ââââââââââââââââââââââââââââââââââââââââââââââï¿½?
// 2. çå®å·¥å· ï¿½?éå® projects/calculator/
// ââââââââââââââââââââââââââââââââââââââââââââââï¿½?

function registerCalculatorTools(toolkit: Toolkit, projectRoot: string) {
  const resolve = (p: string) => {
    // å¥ç¦» projects/calculator/ åç¼ââprojectRoot å·²ç»åå«ï¿½?
    let clean = p as string;
    if (clean.startsWith("projects/calculator/")) {
      clean = clean.slice("projects/calculator/".length);
    }
    return path.resolve(projectRoot, clean);
  };

  toolkit.register("read_file", async (params) => {
    const fp = resolve(params.file_path as string);
    if (!fs.existsSync(fp)) return { success: false, error: `File not found: ${fp}` };
    try {
      return { success: true, output: fs.readFileSync(fp, "utf-8") };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  const listHandler = async (params: any) => {
    const dp = resolve((params.dir_path ?? params.path ?? ".") as string);
    if (!fs.existsSync(dp)) return { success: false, error: `Dir not found: ${dp}` };
    try {
      const entries = fs.readdirSync(dp, { withFileTypes: true });
      const listing = entries.map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`).join("\n");
      return { success: true, output: listing };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  };
  toolkit.register("list_files", listHandler);
  toolkit.register("list_dir", listHandler);

  toolkit.register("search_code", async (params) => {
    const query = (params.query ?? params.pattern ?? "") as string;
    const dir = resolve((params.path ?? ".") as string);
    if (!query) return { success: false, error: "Missing query/path" };
    try {
      const results: string[] = [];
      const walk = (d: string, depth: number) => {
        if (depth > 4) return;
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            walk(full, depth + 1);
          } else if (entry.isFile() && /\.(html|js|css|ts|json|md)$/.test(entry.name)) {
            const stat = fs.statSync(full);
            if (stat.size > 100 * 1024) continue;
            const content = fs.readFileSync(full, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                results.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
              }
            }
          }
        }
      };
      walk(dir, 0);
      return { success: true, output: results.slice(0, 20).join("\n") || "(no matches)" };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  toolkit.register("write_file", async (params) => {
    const fp = resolve(params.file_path as string);
    if (!fp.startsWith(projectRoot + path.sep)) {
      return { success: false, error: `write_file denied: è·¯å¾è¶ç ï¿½?${fp} ä¸å¨ calculator é¡¹ç®å` };
    }
    try {
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fp, params.content as string, "utf-8");
      return { success: true, output: `Wrote ${Buffer.byteLength(params.content as string)} bytes to ${fp}` };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  const DANGEROUS = new RegExp("\\b(rm\\s+-rf|del\\s+/F|format\\s|shutdown|reboot|sudo|chmod\\s+777|>/dev/|/etc/)");
  toolkit.register("run_shell", async (params) => {
    const cmd = (params.command ?? "") as string;
    if (DANGEROUS.test(cmd)) return { success: false, error: "Dangerous command blocked" };
    if (!cmd.startsWith("node") && !cmd.startsWith("npx") && !cmd.startsWith("npm")) {
      return { success: false, error: `Only node/npx/npm allowed. Got: ${cmd.slice(0, 50)}` };
    }
    try {
      const { execSync } = await import("node:child_process");
      const out = execSync(cmd, { cwd: projectRoot, timeout: 30_000, encoding: "utf-8" });
      return { success: true, output: out };
    } catch (e: any) {
      return { success: false, error: String(e.stderr ?? e.message ?? e).slice(0, 500) };
    }
  });
}

// ââââââââââââââââââââââââââââââââââââââââââââââï¿½?
// 3. ç§å­è®°å¿
// ââââââââââââââââââââââââââââââââââââââââââââââï¿½?

function seedMemories(memory: MemoryStore, agentType: string): { lessonId: string; reviewId: string } {
  // åæ¥ååï¼é²æ­¢éå¤æ­ï¿½?
  const existingLesson = memory.read({ metadataFilter: { taskId: "lesson-math-mock" }, limit: 1 });
  const existingReview = memory.read({ metadataFilter: { taskId: "review-math-coupling" }, limit: 1 });

  const lessonId = existingLesson.length > 0
    ? existingLesson[0].id
    : memory.write({
        memoryType: MemoryType.Episodic,
        content: {
          taskType: "code",
          entities: ["math", "calculator", "arithmetic"],
          decision: "ä¸æ¬¡å®ç° math-utils æ¶å¿ï¿½?mock ä¾èµå¯¼è´ CI çº¢äºä¸ä¸åãæè®­ï¼åæ¨¡åååç¡®è®¤ä¾èµè·¯å¾ï¼åå®ç«å³è·æµè¯éªè¯ï¿½?,
          outcome: "fixed",
        },
        summary: "ãæ½å·¥æè®­ãå math-utils æ¶å¿ï¿½?mock å¯¼è´ CI æ¥éï¼æï¿½?2 å°æ¶æåç°ä¾èµè·¯å¾é®é¢ãæ°æ¨¡åå¡å¿åç¡®è®¤ä¾èµï¿½?,
        agentType: agentType as any,
        creatorId: agentType,
        metadata: { taskId: "lesson-math-mock", module: "math" },
      });

  const reviewId = existingReview.length > 0
    ? existingReview[0].id
    : memory.write({
        memoryType: MemoryType.Episodic,
        content: {
          taskType: "review",
          entities: ["math", "calculator", "parser"],
          decision: "å®¡æ¥ math-utils æ¶åç°è¡¨è¾¾å¼è§£æåè®¡ç®é»è¾è¦åå¨åä¸å½æ°éï¼å»ºè®®æå Parser ï¿½?Calculatorãå¦å¤éè¯¯å¤çä¸å®æ´ï¼é¤ä»¥é¶æªå¤çï¿½?,
          outcome: "needs_fix",
        },
        summary: "ãå®¡æ¥æ¡£æ¡ãmath-utils å®¡æ¥ç»è®ºï¼è¡¨è¾¾å¼è§£æåè®¡ç®é»è¾è¦åï¼éè¯¯å¤çä¸å®æ´ï¼é¤ä»¥é¶/éæ³å­ç¬¦ï¼ãå»ºè®®æåæ¨¡åï¿½?,
        agentType: agentType as any,
        creatorId: agentType,
        metadata: { taskId: "review-math-coupling", module: "math" },
      });

  // å¹ç­å»ºç«å³èï¼link èªå¸¦å»éï¿½?
  memory.link(reviewId, lessonId, LinkType.RefactoredFrom, agentType);
  memory.link(lessonId, reviewId, LinkType.CitedInCommittee, agentType);

  return { lessonId, reviewId };
}

// ââââââââââââââââââââââââââââââââââââââââââââââï¿½?
// 4. ä¸»æµï¿½?
// ââââââââââââââââââââââââââââââââââââââââââââââï¿½?

/** Agent ç±»å ï¿½?äººç±»å¯è¯»åç§° */
function agentName(type: string): string {
  const map: Record<string, string> = {
    code: "é¿è´ï¿½?(Code)",
    review: "å»æ´ (Review)",
    inspector: "å®æ (Inspector)",
    browser: "å®µå®« (Browser)",
    analysis: "çº³è¥¿ï¿½?(Analysis)",
    "doc-govern": "åå (DocGovern)",
    loop: "è«å¨ (Loop)",
    ops: "åæ (Ops)",
  };
  return map[type] ?? type;
}

async function main() {
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) { console.error("ï¿½?DEEPSEEK_API_KEY æªè®¾ï¿½?); process.exit(1); }

  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-reasoner";
  const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-v4-pro";
  const WORKSPACE = process.cwd();

  const CALC_DIR = path.resolve(WORKSPACE, "projects", "calculator");
  const WEBUI_DIR = path.join(CALC_DIR, "webui");

  // ç¡®ä¿ç®å½å­å¨
  for (const d of [CALC_DIR, WEBUI_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  // æ¸ç webui/ ç®å½ä¸­ä¸æ¬¡è¿è¡çæ®çæä»¶
  if (fs.existsSync(WEBUI_DIR)) {
    for (const entry of fs.readdirSync(WEBUI_DIR)) {
      const full = path.join(WEBUI_DIR, entry);
      if (fs.statSync(full).isFile()) fs.unlinkSync(full);
    }
  }

  // æ¸ç .cortex/e2e-output æ®çæä»¶ï¼Agent å¯è½åå°è¿éï¿½?test.js ç­ï¼
  const e2eOutDir = path.join(CALC_DIR, ".cortex", "e2e-output");
  if (fs.existsSync(e2eOutDir)) {
    for (const entry of fs.readdirSync(e2eOutDir)) {
      fs.unlinkSync(path.join(e2eOutDir, entry));
    }
  }

  // æ¸çåµå¥è·¯å¾ï¼Agent å¯è½åå° projects/calculator/projects/... å¯¼è´è·¯å¾éå¤ï¿½?
  const nestedDir = path.join(CALC_DIR, "projects");
  if (fs.existsSync(nestedDir)) {
    fs.rmSync(nestedDir, { recursive: true, force: true });
  }

  console.log("ââââââââââââââââââââââââââââââââââââââââââââââââââââ");
  console.log("ï¿½?  ð WebUI è®¡ç®ï¿½?ï¿½?MetaAgent èªè§ï¿½?+ å®µå®«éªè¯       ï¿½?);
  console.log("ââââââââââââââââââââââââââââââââââââââââââââââââââââ\n");
  console.log(`  é¡¹ç®: ${CALC_DIR}`);
  console.log(`  Model: ${CHAT_MODEL}`);
  console.log(`  Base:  ${BASE_URL}\n`);

  // ââ åå§åç»ï¿½?ââ
  console.log("ð¢ [Phase 1] åå§åç»ï¿½?..");

  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    reasonerModel: REASONER_MODEL,
    reasoningEffort: "high",
  });
  adapter.setCacheEnabled(true);

  const metaAgent = new MetaAgent(adapter);
  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();
  const gate = new ConfirmGate();
  gate.bypassAll();

  const memory = new MemoryStore();
  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-webui-calc.db");
  await memory.init(MEMORY_DB);
  console.log(`   ï¿½?MemoryStore: ${MEMORY_DB}`);

  const seeds = seedMemories(memory, AgentType.Code);
  console.log(`   ï¿½?ç§å­è®°å¿: lesson=${seeds.lessonId.slice(0, 20)}...  review=${seeds.reviewId.slice(0, 20)}...\n`);

  // ââ Agent æ± æ³¨ï¿½?ââ
  pool.register({ type: AgentType.Code, maxInstances: 3 });
  pool.register({ type: AgentType.Review, maxInstances: 2 });
  pool.register({ type: AgentType.Inspector, maxInstances: 2 });
  pool.register({ type: AgentType.Browser, maxInstances: 1 });
  pool.register({ type: AgentType.Analysis, maxInstances: 2 });
  pool.register({ type: AgentType.DocGovern, maxInstances: 1 });
  pool.register({ type: AgentType.Ops, maxInstances: 1 });
  pool.register({ type: AgentType.Loop, maxInstances: 1 });

  const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

  // ââ æ³¨å Agent ââ
  console.log("ð¢ [Phase 2] æ³¨åå«ä½ä¸å®¶...");

  // CodeAgentï¼é¿è´å¤ï¼âï¿½?ç¼éæ¯å£«ï¼åä»£ç ãä¿® bugãéï¿½?
  const codeToolkit = new Toolkit(gate);
  registerCalculatorTools(codeToolkit, CALC_DIR);
  const codeAgent = new CodeAgent(adapter, codeToolkit, memory);
  await codeAgent.wakeup();
  scheduler.register(AgentType.Code, codeAgent, CHAT_MODEL);
  console.log("   ï¿½?é¿è´ï¿½?(Code) ï¿½?ç¼éæ¯å£«");

  // ReviewAgentï¼å»æ´ï¼âï¿½?çè¡¡æï¼ä»£ç å®¡æ¥
  const reviewToolkit = new Toolkit(gate);
  registerCalculatorTools(reviewToolkit, CALC_DIR);
  const reviewAgent = new ReviewAgent(adapter, reviewToolkit, memory);
  await reviewAgent.wakeup();
  scheduler.register(AgentType.Review, reviewAgent, CHAT_MODEL);
  console.log("   ï¿½?å»æ´ (Review) ï¿½?çè¡¡ï¿½?);

  // InspectorAgentï¼å®æï¼âï¿½?ä¾¦å¯éªå£«ï¼çº¯äºå®éé
  const inspectorToolkit = new Toolkit(gate);
  registerCalculatorTools(inspectorToolkit, CALC_DIR);
  const inspectorAgent = new InspectorAgent(adapter, inspectorToolkit);
  inspectorAgent.setWorkspaceRoot(CALC_DIR);
  await inspectorAgent.wakeup();
  scheduler.register(AgentType.Inspector, inspectorAgent, CHAT_MODEL);
  console.log("   ï¿½?å®æ (Inspector) ï¿½?ä¾¦å¯éªå£«");

  // BrowserAgentï¼å®µå®«ï¼âï¿½?çè±åºèæ¿ï¼UI éªè¯
  const browserToolkit = new Toolkit(gate);
  const browserAgent = new BrowserAgent(adapter, browserToolkit);
  browserAgent.setWorkspaceRoot(WORKSPACE);
  await browserAgent.wakeup();
  scheduler.register(AgentType.Browser, browserAgent, CHAT_MODEL);
  console.log("   ï¿½?å®µå®« (Browser) ï¿½?çè±åºèæ¿");

  // AnalysisAgentï¼çº³è¥¿å¦²ï¼âï¿½?èç¥ï¼æ¶æåï¿½?
  const analysisToolkit = new Toolkit(gate);
  registerCalculatorTools(analysisToolkit, CALC_DIR);
  const analysisAgent = new AnalysisAgent(adapter, analysisToolkit, memory);
  await analysisAgent.wakeup();
  scheduler.register(AgentType.Analysis, analysisAgent, CHAT_MODEL);
  console.log("   ï¿½?çº³è¥¿ï¿½?(Analysis) ï¿½?èç¥");

  // DocGovernAgentï¼ååï¼âï¿½?å¤©ææï¼å¾æ³å®¡è®¡
  const docGovernToolkit = new Toolkit(gate);
  registerCalculatorTools(docGovernToolkit, CALC_DIR);
  const docGovernAgent = new DocGovernAgent(adapter, docGovernToolkit);
  await docGovernAgent.wakeup();
  scheduler.register(AgentType.DocGovern, docGovernAgent, CHAT_MODEL);
  console.log("   ï¿½?åå (DocGovern) ï¿½?å¤©æï¿½?);

  // LoopAgentï¼è«å¨ï¼âï¿½?å ææ¯å£«ï¼æ¨¡å¼æï¿½?
  const loopToolkit = new Toolkit(gate);
  registerCalculatorTools(loopToolkit, CALC_DIR);
  const loopAgent = new LoopAgent(adapter, loopToolkit);
  await loopAgent.wakeup();
  scheduler.register(AgentType.Loop, loopAgent, CHAT_MODEL);
  console.log("   ï¿½?è«å¨ (Loop) ï¿½?å ææ¯å£«");

  // OpsAgentï¼åæï¼âï¿½?ååå­è¹é¿ï¼è¿ç»´é¨ç½²
  const opsToolkit = new Toolkit(gate);
  registerCalculatorTools(opsToolkit, CALC_DIR);
  const opsAgent = new OpsAgent(adapter, opsToolkit);
  await opsAgent.wakeup();
  scheduler.register(AgentType.Ops, opsAgent, CHAT_MODEL);
  console.log("   ï¿½?åæ (Ops) ï¿½?ååå­è¹é¿\n");

  // ââ MetaAgent èªè§ï¿½?ââ
  console.log("ð¢ [Phase 3] çé¨ï¼MetaAgentï¼çè§£æå¾ãèªè§åä»»å¡ï¿½?..\n");

  const intent = [
    "ä»é¶å®ç°ä¸ï¿½?WebUI è®¡ç®å¨ç³»ç»ãä»£ç å¨é¨æ¾ï¿½?projects/calculator/webui/ ç®å½ä¸ï¿½?,
    "ä¸è¦åä»»ï¿½?test.js ææµè¯æä»¶ââåªéï¿½?calculator.js ï¿½?index.html ä¸¤ä¸ªæä»¶ï¿½?,
    "",
    "â ï¸ å³é®çº¦æï¿½?,
    "1. ææææ¡£å¿é¡»ç¨ write_file å·¥å·è¾åºå°ç£çââä¸è½åªå¨èå­éåæï¼å¿é¡»ååºæä»¶ï¿½?,
    "2. HTML é¡µé¢åç´ ï¿½?ID å¿é¡»ä½¿ç¨çº¦å®åç§°ï¼è¾å¥æ¡ #expressionãæï¿½?#calculateBtnãç»æåº #resultï¿½?,
    "   ä¸è¦ç¨å¶ï¿½?IDï¼ä¸è¦èªè¡åæ¥ï¿½?,
    "",
    "åè½è¦æ±ï¿½?,
    "ï¿½?calculator.js ï¿½?çº¯æµè§å¨ï¿½?JavaScriptï¼ä¸ï¿½?Node.js APIï¼ä¸è¦ç¨ require/fs/pathï¼ï¿½?,
    "  evaluate(str) è§£æ +,-,*,/ åæ¬å·è¡¨è¾¾å¼ï¼éµå¾ªæ åè¿ç®ç¬¦ä¼åçº§ï¿½?,
    "  é¤ä»¥é¶è¿ï¿½?'NaN'ï¼éæ³å­ç¬¦åè¯­æ³éè¯¯æåºæç¡®ï¿½?Errorï¿½?,
    "ï¿½?index.html ï¿½?å®æ´çç¨æ·çé¢ãä½¿ç¨çº¦ï¿½?IDï¿½?expressionï¼è¾å¥æ¡ï¼ï¿½?calculateBtnï¼æé®ï¼ï¿½?resultï¼ç»æåºï¼ï¿½?,
    "  éè¿ <script src=\"calculator.js\"> å è½½é»è¾ãå¿é¡»è½éè¿ file:// åè®®ç´æ¥æå¼ï¿½?,
    "",
    "éè¦ç±é¿è´å¤åï¿½?write_file ååºè¿ä¸¤ä¸ªæä»¶ï¼ç¶åå®æå»ä¾¦å¯æä»¶æ¯å¦é½å¨ãåå®¹æ¯å¦æ­£ç¡®ï¼",
    "æ¥ä¸æ¥å®µå®«ç¨æµè§å¨éªè¯ä¸ç»è¡¨è¾¾å¼ï¿½?+3*4=14, (10-2)/4=2, 1/0=NaNï¼ï¼",
    "å»æ´å®¡æ¥ä»£ç è´¨éï¼çº³è¥¿å¦²åæ¶æåæå¹¶ï¿½?write_file è¾åº architecture.mdï¿½?,
    "ååååè§å®¡è®¡å¹¶ï¿½?write_file è¾åº audit-report.mdï¼è«å¨æç¼æ¨¡å¼ï¼åææ£æ¥é¨ç½²å°±ç»ªæ§ï¿½?,
    "",
    "è¿è¦ï¿½?write_file è¾åºä»¥ä¸ææ¡£ï¼æ¯ä»½ç¬ç«ææä»¶ï¼æ¾ï¿½?webui/ ç®å½ä¸ï¼",
    "ï¿½?webui/README.md ï¿½?é¡¹ç®ææ¡£ï¼ç¨æ³ãæä»¶ç»æãAPI ææ¡£ï¼evaluate ç­¾ååç¤ºä¾ï¼ãæ¶æå¾ï¿½?,
    "ï¿½?webui/audit-report.md ï¿½?ååçåè§å®¡è®¡æ¥åï¼è§èæ§æ£æ¥ç»æãåç°çé®é¢ãæ¹è¿å»ºè®®ï¿½?,
    "ï¿½?webui/architecture.md ï¿½?çº³è¥¿å¦²çæ¶æåæï¼æ¨¡åååãèè´£åç¦»ãå¯æ©å±æ§è¯ä¼°ãä¼åæ¹åï¿½?,
  ].join("\n");

  console.log("   ð ç¨æ·æå¾:");
  console.log(`   ${intent.split("\n").slice(0, 5).join("\n").slice(0, 200)}...\n`);

  console.log("   ï¿½?çé¨æ­£å¨è§å...");
  const planStart = Date.now();
  let nodes: TaskNode[];
  try {
    nodes = await metaAgent.plan(intent, {
      existingTags: ["implementation", "browser", "ui_verify"],
    });
  } catch (e) {
    console.error(`   ï¿½?MetaAgent è§åå¤±è´¥: ${e}`);
    process.exit(1);
  }
  console.log(`   ï¿½?è§åå®æ (${Date.now() - planStart}ms): ${nodes.length} ä¸ªä»»å¡èç¹\n`);

  if (nodes.length === 0) {
    console.error("   ï¿½?MetaAgent æªçæä»»ä½ä»»å¡èï¿½?);
    process.exit(1);
  }

  for (const n of nodes) {
    const parent = n.parentId ? ` ï¿½?child of [${n.parentId.slice(0, 16)}]` : " ï¿½?root";
    console.log(`     [${n.type}] ${n.tags.join(", ")}  ${n.id}${parent}`);
    const payloadPreview = n.payload.slice(0, 100);
    console.log(`        ${payloadPreview}...`);
  }

  // ä¾èµç»æè¯æ­
  const roots = nodes.filter((n) => !n.parentId);
  const nonRoots = nodes.filter((n) => n.parentId);
  console.log(`\n   ð³ ä¾èµç»æ: ${roots.length} ä¸ªæ ¹èç¹, ${nonRoots.length} ä¸ªå­èç¹`);
  if (nonRoots.length === 0) {
    console.log("   â ï¸ è¯æ­ï¼ææèç¹é½æ¯æ ¹èç¹ââçé¨æ²¡æå»ºç«æ¶åºä¾èµï¼");
  } else {
    // æå±çº§å±ï¿½?
    const byParentId = new Map<string, TaskNode[]>();
    const rootById = new Map<string, TaskNode>();
    for (const n of nodes) {
      rootById.set(n.id, n);
      if (n.parentId) {
        const existing = byParentId.get(n.parentId);
        if (existing) existing.push(n); else byParentId.set(n.parentId, [n]);
      }
    }
    let layer = 0;
    let current = roots;
    while (current.length > 0) {
      console.log(`   Layer ${layer}: ${current.map((n) => agentName(n.tags[0] ?? n.type).split(" ")[0]).join(" ï¿½?")}`);
      const next: TaskNode[] = [];
      for (const n of current) {
        const children = byParentId.get(n.id);
        if (children) next.push(...children);
      }
      current = next;
      layer++;
    }
  }
  console.log();

  // ââ å¥æ¿ ââ
  for (const n of nodes) board.addNode(n);

  // ââ äºä»¶çå¬ ââ
  observer.on(PipelinePriority.HIGH, (e) => {
    const payload = e.payload as any;
    const nodeId = payload?.nodeId ?? "";
    const snippet = JSON.stringify(payload).slice(0, 120);
    console.log(`   ð¡ ${e.type}: ${nodeId ? nodeId : snippet}`);
  });

  // ââ æ§è¡ ââ
  console.log("ð¢ [Phase 4] Scheduler æ§è¡ ï¿½?å«ä½ä¸å®¶å¼å§åï¿½?..\n");
  console.log("âââââââââââââââââââââââââââââââââââââââââââââââââ\n");

  const execStart = Date.now();
  const report = await scheduler.executeAll();
  const execDuration = Date.now() - execStart;

  // ââ ç»æ ââ
  console.log("\nââââââââââââââââââââââââââââââââââââââââââââââââââââ");
  console.log("ï¿½?  ð æ§è¡ç»æ                                     ï¿½?);
  console.log("ââââââââââââââââââââââââââââââââââââââââââââââââââââ\n");
  console.log(`   å®æ: ${report.completed}  å¤±è´¥: ${report.failed}  èæ¶: ${execDuration}ms`);
  console.log();

  const allNodes = board.getAllNodes();
  for (const n of allNodes) {
    const status = n.status === "done" ? "ï¿½? : n.status === "failed" ? "ï¿½? : "ï¿½?;
    const agentLabel = agentName(n.results[0]?.agentType ?? n.tags[0]);
    console.log(`   ${status} [${n.type}] ${n.tags.join(", ")}  ${agentLabel}`);
  }
  console.log();

  // ââ ä¸å®¶åè¨ ââ
  console.log("ââââââââââââââââââââââââââââââââââââââââââââââââââââ");
  console.log("ï¿½?  ð­ ä¸å®¶åè¨å®å½                                  ï¿½?);
  console.log("ââââââââââââââââââââââââââââââââââââââââââââââââââââ\n");

  for (const n of allNodes) {
    if (n.results.length === 0 || n.status === "pending") continue;
    const r = n.results[0];
    const label = agentName(r.agentType ?? "unknown");
    const content = (r.output ?? r.error ?? "(æ è¾ï¿½?").trim();

    console.log(`ââ ${r.success ? "ï¿½? : "ï¿½?} ${label} ââ`);
    // å®æ´è¾åºï¼ä¸æªæ­
    const indent = "   ";
    const lines = content.split("\n");
    for (const line of lines) {
      console.log(`${indent}${line}`);
    }
    console.log();
  }

  // ââ äº§åºæä»¶æ£ï¿½?ââ
  console.log("ââ äº§åºæä»¶ ââ");
  const checkFiles = [
    "webui/index.html",
    "webui/calculator.js",
    "webui/README.md",
    "webui/audit-report.md",
    "webui/architecture.md",
  ];
  for (const rel of checkFiles) {
    const fp = path.join(CALC_DIR, rel);
    const exists = fs.existsSync(fp);
    const size = exists ? fs.statSync(fp).size : 0;
    console.log(`   ${exists ? "ï¿½? : "ï¿½?} ${rel}  ${exists ? `(${size} bytes)` : "(æªçï¿½?"}`);
  }
  console.log();

  // ââ åå®¹æ£ï¿½?ââ
  const indexPath = path.join(CALC_DIR, "webui", "index.html");
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, "utf-8");
    const hasInput = /#expression|id\s*=\s*["']expression/.test(html);
    const hasButton = /#calculateBtn|calculateBtn|Calculate|è®¡ç®/.test(html);
    const hasResult = /#result|id\s*=\s*["']result/.test(html);
    const hasScript = /calculator\.js|script\s*src/.test(html);
    console.log("ââ HTML ç»æéªè¯ ââ");
    console.log(`   ${hasInput ? "ï¿½? : "ï¿½?} #expression input`);
    console.log(`   ${hasButton ? "ï¿½? : "ï¿½?} calculate button`);
    console.log(`   ${hasResult ? "ï¿½? : "ï¿½?} #result display`);
    console.log(`   ${hasScript ? "ï¿½? : "ï¿½?} calculator.js loaded`);
    console.log();
  }

  const jsPath = path.join(CALC_DIR, "webui", "calculator.js");
  if (fs.existsSync(jsPath)) {
    const js = fs.readFileSync(jsPath, "utf-8");
    const hasEvaluate = /evaluate|calculate|compute/i.test(js);
    const hasOperator = /[\+\-\*\/]/.test(js);
    console.log("ââ JS é»è¾éªè¯ ââ");
    console.log(`   ${hasEvaluate ? "ï¿½? : "ï¿½?} evaluate/compute function`);
    console.log(`   ${hasOperator ? "ï¿½? : "ï¿½?} arithmetic operators`);
    console.log();
  }

  // ââ ææ¡£åå®¹æ£ï¿½?ââ
  const docSpecs: Array<{ file: string; label: string; checks: Array<{ name: string; pattern: RegExp }> }> = [
    {
      file: "webui/README.md",
      label: "READMEï¼é¡¹ç®ææ¡£ï¼",
      checks: [
        { name: "é¡¹ç®æ¦è¿°", pattern: /æ¦è¿°|overview|ç®ä»|ä»ç»/i },
        { name: "ä½¿ç¨æ¹æ³", pattern: /ä½¿ç¨|ç¨æ³|usage|how to/i },
        { name: "API ææ¡£", pattern: /evaluate|API|æ¥å£|å½æ°/i },
        { name: "æä»¶/æ¶æ", pattern: /æä»¶|ç»æ|ç®å½|structure|architecture/i },
      ],
    },
    {
      file: "webui/audit-report.md",
      label: "å®¡è®¡æ¥å",
      checks: [
        { name: "æ£æ¥é¡¹åè¡¨", pattern: /æ£æ¥|å®¡è®¡|audit|è§è|compliance/i },
        { name: "é®é¢åç°", pattern: /é®é¢|issue|ç¼ºé·|é£é©|è¿è§/i },
        { name: "æ¹è¿å»ºè®®", pattern: /å»ºè®®|æ¹è¿|recommend|ä¿®å¤/i },
      ],
    },
    {
      file: "webui/architecture.md",
      label: "æ¶æåæ",
      checks: [
        { name: "æ¨¡ååå", pattern: /æ¨¡å|module|ç»ä»¶|component/i },
        { name: "èè´£åç¦»", pattern: /èè´£|è´£ä»»|åç¦»|è§£è¦|separation/i },
        { name: "è¯ä¼°/å»ºè®®", pattern: /è¯ä¼°|å»ºè®®|ä¼å|æ¹è¿|å¯æ©ï¿½?i },
      ],
    },
  ];

  for (const spec of docSpecs) {
    const fp = path.join(CALC_DIR, spec.file);
    if (!fs.existsSync(fp)) {
      console.log(`ââ ${spec.label} ââ`);
      console.log(`   ï¿½?æä»¶æªçæ\n`);
      continue;
    }
    const content = fs.readFileSync(fp, "utf-8");
    console.log(`ââ ${spec.label} ââ`);
    for (const c of spec.checks) {
      console.log(`   ${c.pattern.test(content) ? "ï¿½? : "ï¿½?} ${c.name}`);
    }
    console.log(`   å­æ°: ${content.length}\n`);
  }

  // ââ å®µå®«ä¾¦å¯ ââ
  console.log("ââ å®µå®«ï¼BrowserAgentï¼æ§è¡æï¿½?ââ");
  const browserNodes = allNodes.filter((n) =>
    n.tags.some((t) => t === "browser" || t === "ui_verify"),
  );
  if (browserNodes.length === 0) {
    console.log("   â ï¸ MetaAgent æªè§åä»»ä½æµè§å¨éªè¯ä»»å¡ï¿½?);
    console.log("   çæµçé¨è®¤ä¸ºï¿½?WebUI ä¸éè¦æµè§å¨éªè¯ï¼æè®¡åä¸å®æ´ã\n");
  } else {
    for (const n of browserNodes) {
      if (n.status === "done") {
        console.log(`   ï¿½?${n.id}: éªè¯å®æ`);
      } else {
        console.log(`   ï¿½?${n.id}: ${n.status}`);
      }
    }
  }
  console.log();

  // ââ è®°å¿ç³»ç»è¯æ­ ââ
  console.log("ââ è®°å¿ç³»ç»è¯æ­ ââ");
  const allMemories = memory.read({});
  const accessed = allMemories.filter((m) => m.lastAccessedAt > m.createdAt + 1000);
  console.log(`   æ»è®°ï¿½? ${allMemories.length}  è¢«è®¿é®è¿: ${accessed.length}`);
  for (const m of accessed) {
    console.log(`     ð ${m.summary.slice(0, 100)}`);
  }
  console.log();

  // ââ æ¸ç ââ
  try { await browserAgent.shutdown(); } catch { /* éé» */ }

  console.log(`   å¨æµç¨èæ¶: ${execDuration}ms\n`);
}

main().catch((err) => {
  console.error("ï¿½?WebUI è®¡ç®ï¿½?E2E å¤±è´¥:", err);
  // å³ä½¿å¤±è´¥ä¹å°è¯æ¸ï¿½?
  process.exit(1);
});
