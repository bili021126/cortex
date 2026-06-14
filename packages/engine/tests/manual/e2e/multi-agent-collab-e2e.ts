/**
 * multi-agent-collab-e2e.ts — 十人协作全链路自主修复验证 v2
 *
 * 参与者: 甘雨(meta), 希格雯(fix), 刻晴(review), 纳西妲(analysis),
 *         凝光(doc-govern), 莫娜(loop), 久岐忍(api), 艾尔海森(data),
 *         钟离(strategist), 霜凝(strategist)
 *
 * 原则:
 *   - 策略不定: 不指定 preferredStrategy, 由 Agent 自行决定
 *   - 调度不定: 不手动编排 Phase, 由 Scheduler + MetaAgent 自主协同
 *   - 源码只读: 工具层限制 write_file 仅在 tests/ 目录
 *   - 独立记忆库: memory-multi-agent-collab.db
 *
 * v2 验证目标:
 *   多 Agent 协作修复 e2e 测试文件编译错误 → npx tsc --noEmit 零报错
 *   目标目录: packages/engine/tests/manual/e2e/ (11 个 .ts 文件)
 *   要求: 编译通过即可，无需运行
 *
 * 用法: npx tsx tests/manual/e2e/multi-agent-collab-e2e.ts [--verbose]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentType, type Tag, type TaskNode, type SkillTemplate, setAgentRegistry } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import {
  SkillRegistry,
  TaskBoard,
  AgentPool,
  Scheduler,
  PipelineObserver,
  ConfirmGate,
  MetaAgent,
  createAgent} from "@cortex/engine";
import { Toolkit } from "@cortex/platform";
import { MemoryStore } from "@cortex/memory-store";
import type { AgentFactoryConfig } from "@cortex/engine";
import { resolveLlmConfig } from "../config/llm-defaults";

// ── 配置 ──

let VERBOSE = false;
const SEP = "═".repeat(60);

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const m = line.replace(/\r$/, "").match(/^([^=]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].trim();
    }
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("❌ DEEPSEEK_API_KEY 未设置");
    process.exit(1);
  }
}

function header(t: string): void { console.log(`\n${SEP}\n  ${t}\n${SEP}`); }
function pass(label: string): void { console.log(`  ✅ ${label}`); }
function fail(label: string, d?: string): void { console.log(`  ❌ ${label}`); if (d) console.log(`     ${d}`); }
function log(label: string, v: string): void { console.log(`  📋 ${label}: ${v}`); }
function dbg(m: string): void { if (VERBOSE) console.log(`  🔍 ${m}`); }

// ── 工具注册 ──

function registerTools(toolkit: Toolkit, projectRoot: string) {
  // 所有工具基础路径为 packages/engine，Agent 调用 list_files(".") 即是 engine 根目录
  const engineRoot = path.join(projectRoot, "packages", "engine");
  const resolve = (p: string) => path.resolve(engineRoot, p);

  toolkit.register("read_file", async (params: any) => {
    let fp = params.file_path as string;
    if (!path.isAbsolute(fp)) fp = resolve(fp);
    if (!fs.existsSync(fp)) {
      // 兜底：尝试 basename + engine 测试目录
      const alt = path.join(engineRoot, "tests", "manual", "e2e", path.basename(fp));
      if (fs.existsSync(alt)) fp = alt;
      else return { success: false, error: `File not found: ${fp}` };
    }
    const raw = fs.readFileSync(fp, "utf-8");
    const lines = raw.split("\n");
    const startLine = (params.start_line as number) ?? 1;
    const endLine = (params.end_line as number) ?? lines.length;
    const sliced = lines.slice(Math.max(0, startLine - 1), endLine).join("\n");
    const max = 6000;
    const output = sliced.length > max
      ? sliced.slice(0, max) + `\n...(截断, ${sliced.length} chars, 行 ${startLine}-${endLine} / 共 ${lines.length} 行)`
      : sliced + `\n(行 ${startLine}-${Math.min(endLine, lines.length)} / 共 ${lines.length} 行)`;
    dbg(`read_file ${path.relative(engineRoot, fp)} L${startLine}-${endLine} (${sliced.length}c)`);
    return { success: true, output };
  });

  toolkit.register("write_file", async (params: any) => {
    let fp = params.file_path as string;
    if (!path.isAbsolute(fp)) fp = resolve(fp);
    // 只允许写入 tests/ 目录
    if (!fp.includes(path.sep + "tests" + path.sep)) {
      return { success: false, error: `write_file 拒绝: 只允许写入 tests/ 目录。路径: ${fp}` };
    }
    const content = params.content_blob as string;
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, content, "utf-8");
    dbg(`write_file ${path.relative(engineRoot, fp)} (${content.length}c)`);
    return { success: true, output: `Wrote ${Buffer.byteLength(content)} bytes` };
  });

  // 🔥 局部替换工具——Agent 无需读完整文件即可做定向修复
  toolkit.register("replace_in_file", async (params: any) => {
    let fp = params.file_path as string;
    if (!path.isAbsolute(fp)) fp = resolve(fp);
    // 只允许写入 tests/ 目录
    if (!fp.includes(path.sep + "tests" + path.sep)) {
      return { success: false, error: `replace_in_file 拒绝: 只允许写入 tests/ 目录。路径: ${fp}` };
    }
    if (!fs.existsSync(fp)) return { success: false, error: `File not found: ${fp}` };
    const oldText = params.old_text as string;
    const newText = params.new_text as string;
    const replaceAll = (params.replace_all as boolean) ?? false;
    if (!oldText || oldText === newText) return { success: false, error: "需要 old_text 且 old_text ≠ new_text" };
    const raw = fs.readFileSync(fp, "utf-8");
    if (replaceAll) {
      if (!raw.includes(oldText)) return { success: false, error: `未找到匹配文本` };
      const count = raw.split(oldText).length - 1;
      const result = raw.split(oldText).join(newText);
      fs.writeFileSync(fp, result, "utf-8");
      return { success: true, output: `替换 ${count} 处` };
    }
    const idx = raw.indexOf(oldText);
    if (idx === -1) return { success: false, error: `未找到匹配文本` };
    const result = raw.slice(0, idx) + newText + raw.slice(idx + oldText.length);
    fs.writeFileSync(fp, result, "utf-8");
    const line = raw.slice(0, idx).split("\n").length;
    return { success: true, output: `行${line}: 替换成功` };
  });

  toolkit.register("run_shell", async (params: any) => {
    let cmd = ((params.command ?? "") as string).replace(/^cd\s+\S+\s*(&&|;)\s*/i, "").trim();
    if (!cmd) return { success: false, error: "缺少 command" };
    // 全部放开——e2e 修复需要自由调用编译/分析命令
    try {
      const { execSync } = await import("node:child_process");
      const out = execSync(cmd, { cwd: engineRoot, timeout: 120_000, encoding: "utf-8", maxBuffer: 2 * 1024 * 1024 });
      dbg(`run_shell ${cmd.slice(0, 60)} OK (${out.length}c)`);
      return { success: true, output: out.slice(0, 3000) || "(exit 0)" };
    } catch (e: any) {
      const stderr = (e.stderr ?? "") as string;
      const stdout = (e.stdout ?? "") as string;
      const msg = (stderr + stdout).slice(0, 2000) || e.message?.slice(0, 300) || String(e);
      return { success: false, error: `Command failed (exit ${e.status}): ${msg}` };
    }
  });

  // 🔥 专用工具：只检查 e2e 编译，过滤掉非 e2e 文件的错误，防止上下文爆炸
  toolkit.register("check_e2e_compile", async () => {
    try {
      const { execSync } = await import("node:child_process");
      execSync("npx tsc --noEmit --project tsconfig.test.json", {
        cwd: engineRoot, timeout: 120_000, encoding: "utf-8", maxBuffer: 2 * 1024 * 1024});
      return { success: true, output: "✅ 所有 e2e 文件编译通过，零错误！" };
    } catch (e: any) {
      const all = ((e.stderr ?? "") + (e.stdout ?? "")) as string;
      const e2eLines = all.split("\n").filter((l: string) => l.includes("tests/manual/e2e/") && l.includes("error TS"));
      if (e2eLines.length === 0) {
        // tsc 失败但 e2e 无错误——可能是其他文件的错误
        const otherCount = all.split("\n").filter((l: string) => l.includes("error TS")).length;
        return { success: true, output: `⚠️ e2e 文件无编译错误。其他文件有 ${otherCount} 个错误（非 e2e 范围，忽略）。` };
      }
      // 去重按文件+错误码分组
      const byFile = new Map<string, string[]>();
      for (const l of e2eLines) {
        const m = l.match(/tests\/manual\/e2e\/([^(:]+)\.ts\((\d+),\d+\): (error TS\d+): (.+)/);
        if (m) {
          const [_, file, line, code, msg] = m;
          if (!byFile.has(file)) byFile.set(file, []);
          byFile.get(file)!.push(`${code} L${line}: ${msg}`);
        } else {
          // 兜底：直接取前 100 字符
          if (!byFile.has("_raw")) byFile.set("_raw", []);
          byFile.get("_raw")!.push(l.slice(0, 120));
        }
      }
      let report = `❌ ${e2eLines.length} 个 e2e 编译错误，分布在 ${byFile.size} 个文件：\n`;
      for (const [file, errs] of [...byFile].sort((a, b) => a[0].localeCompare(b[0]))) {
        // 每个文件最多显示 5 个错误
        const deduped = [...new Set(errs)].slice(0, 5);
        report += `\n📄 ${file}.ts (${deduped.length} 类错误):\n`;
        for (const e of deduped) report += `   ${e}\n`;
      }
      dbg(`check_e2e_compile ${e2eLines.length} errors`);
      return { success: false, error: report.slice(0, 3000) };
    }
  });

  toolkit.register("list_files", async (params: any) => {
    const dp = resolve((params.dir_path ?? ".") as string);
    if (!fs.existsSync(dp)) return { success: false, error: `Dir not found: ${dp} (当前在 packages/engine，试试 tests/manual/e2e 或 src)` };
    const entries = fs.readdirSync(dp, { withFileTypes: true }).slice(0, 30);
    return { success: true, output: entries.map(e => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`).join("\n") };
  });

  toolkit.register("search_code", async (params: any) => {
    const q = (params.query ?? "") as string;
    if (!q) return { success: false, error: "缺少 query" };
    try {
      const { execSync } = await import("node:child_process");
      const out = execSync(`npx rg --no-heading -n "${q.replace(/"/g, '\\"')}" packages/engine/tests/ packages/engine/src/`, {
        cwd: projectRoot, timeout: 15_000, encoding: "utf-8", maxBuffer: 256 * 1024}).slice(0, 4000);
      return { success: true, output: out || "(无匹配)" };
    } catch (e: any) {
      if (e.status === 1) return { success: true, output: "(无匹配)" };
      return { success: false, error: `search failed: ${e.message?.slice(0, 100)}` };
    }
  });

  // delete_file 仍然禁止
  toolkit.register("delete_file", async () => ({ success: false, error: "delete_file 在此测试环境不可用" }));
  // parse_ast 使用内置实现——Agent 可用于缩小定位
  // (不注册 stub，保留 Toolkit 内置的 TypeScript Compiler API 实现)
}

// ── 技能 ──

const TEST_FIX_SKILL: SkillTemplate = {
  id: "skill-e2e-compilation-fix",
  name: "E2E测试文件编译修复",
  triggerTags: ["fix", "test", "typescript"] as Tag[],
  trigger: "e2e 测试文件 tsc --noEmit 编译报错：类型错误、导入缺失、接口变更等",
  steps: [
    "check_e2e_compile 获取 e2e 编译错误摘要（已自动过滤非 e2e 错误，去重分组）",
    "read_file 读取报错的 e2e 文件",
    "对比 engine API（read_file src/index.ts）分析根因",
    "write_file 修复编译错误（只改 tests/manual/e2e/ 下的文件）",
    "check_e2e_compile 验证修复结果",
  ],
  expectedOutput: "所有 e2e 文件编译通过，tsc --noEmit 零报错",
  status: "active",
  adoptionCount: 0,
  rejectionCount: 0,
  discoveredBy: "LoopAgent",
  createdAt: Date.now()};

// ── Agent System Prompts ──

const FIX_PROMPT = "你是希格雯，直接修复TS编译错误。工作流: check_e2e_compile→read_file({start_line,end_line})→replace_in_file({replace_all:true})→验证。禁止search_code和读全文件。TS2554: *AgentConfig()加name参数如codeAgentConfig('code')。TS2339: memory.read前加await。用replace_all=true批量改。";

const REVIEW_PROMPT = [
  "你是刻晴，Cortex ReviewAgent。审查修复后的 e2e 测试文件。",
  "核对：导入是否正确、类型是否匹配、是否引用了已废弃的 API。",
  "重点检查改动的文件是否与当前 @cortex/engine 导出一致。",
].join("\n");

const ANALYSIS_PROMPT = [
  "你是纳西妲，Cortex AnalysisAgent。分析 e2e 文件编译失败根因，只读。",
  "优先阅读所有 e2e 文件，列出它们引用的 @cortex/engine API，",
  "然后对比当前 engine 实际导出的 API，找出不匹配项。",
].join("\n");

const GOVERN_PROMPT = "你是凝光，Cortex DocGovernAgent。审计 e2e 文件修复是否只改了编译问题、未改变测试语义，只读。";

const LOOP_PROMPT = "你是莫娜，Cortex LoopAgent。识别 e2e 编译修复中的可复用模式和 API 变更规律，只读。";

const STRATEGY_PROMPT = "你是钟离，Cortex StrategistAgent。审查 e2e 文件修复是否遵守 engine 公开 API 契约，只读。";

const DIRECTION_PROMPT = "你是霜凝，Cortex StrategistAgent。监理所有 e2e 修复方向是否一致、有无互相矛盾的修改，只读。";

const API_PROMPT = "你是久岐忍，Cortex ApiAgent。校验 e2e 文件引用的 engine API 是否与当前版本一致，只读。";

const DATA_PROMPT = "你是艾尔海森，Cortex DataAgent。检查 e2e 文件中的 mock 数据/测试数据是否与当前类型定义一致，只读。";

// ── 主流程 ──

async function main() {
  loadEnv();
  VERBOSE = process.argv.includes("--verbose");
  const API_KEY = process.env.DEEPSEEK_API_KEY!;
  const llmCfg = resolveLlmConfig();
  // 用脚本位置推算项目根目录（沙箱中 process.cwd() 不可靠）
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  let WORKSPACE = path.resolve(__dirname, "..", "..", "..", "..", "..");
  // 兜底：如果推算不对，用已知路径
  if (!fs.existsSync(path.join(WORKSPACE, "package.json"))) {
    // 尝试从 cwd 往上找
    let cwd = process.cwd();
    while (cwd !== path.dirname(cwd)) {
      if (fs.existsSync(path.join(cwd, "package.json"))) { WORKSPACE = cwd; break; }
      cwd = path.dirname(cwd);
    }
  }
  console.log(`  工作区根目录: ${WORKSPACE}`);

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  🤝 十人协作 — 多Agent自主协同修复验证                 ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(`  Chat: ${llmCfg.chatModel}  |  Reasoner: ${llmCfg.reasonerModel}`);
  console.log(`  目标: 修复 e2e 编译 → npx tsc --noEmit 零报错`);
  console.log(`  策略: 不定  |  调度: 不定\n`);

  // ── Phase 1: 引擎初始化 ──
  header("Phase 1 — 舞台搭建");

  const chatAdapter = new LlmAdapter({ apiKey: API_KEY, baseUrl: llmCfg.baseUrl, chatModel: llmCfg.chatModel, reasonerModel: llmCfg.reasonerModel });
  chatAdapter.setCacheEnabled(true);

  const reasonerAdapter = new LlmAdapter({ apiKey: API_KEY, baseUrl: llmCfg.baseUrl, chatModel: llmCfg.reasonerModel, reasonerModel: llmCfg.reasonerModel });
  reasonerAdapter.setCacheEnabled(true);

  const observer = new PipelineObserver();
  const gate = new ConfirmGate(); gate.bypassAll();

  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-multi-agent-collab.db");
  const memory = new MemoryStore();
  await memory.init(MEMORY_DB);
  log("独立记忆库", MEMORY_DB);

  const skillRegistry = new SkillRegistry();
  const skillExecutor = new SkillExecutor(skillRegistry);
  skillRegistry.register(TEST_FIX_SKILL);
  pass(`技能注册: ${TEST_FIX_SKILL.name}`);

  // ── 注册 Agent 池 ──
  const toolkit = new Toolkit(gate);
  registerTools(toolkit, WORKSPACE);

  // 🔧 将 check_e2e_compile / replace_in_file 注入运行时权限白名单，否则 Agent 的 LLM 工具列表里看不到
  setAgentRegistry(
    {},
    {
      [AgentType.Fix]: ["read_file", "write_file", "replace_in_file", "search_code", "web_search", "run_shell", "list_files", "delete_file", "parse_ast", "check_e2e_compile"],
      [AgentType.Analysis]: ["read_file", "write_file", "replace_in_file", "search_code", "web_search", "list_files", "delete_file", "parse_ast", "check_e2e_compile"]},
    [],
  );
  // 注入工具元数据，否则 LLM 看到的是空 description
  toolkit.setToolMeta({
    ...(toolkit as any)._toolMeta,
    check_e2e_compile: {
      category: 2,
      description: "编译检查 e2e 测试文件。运行 npx tsc --noEmit --project tsconfig.test.json 并只返回 e2e 文件的去重错误摘要。零参数。",
      level: 0,
      parameters: { type: "object", properties: {}, required: [] },
      required: []},
    replace_in_file: {
      category: 1, // Write
      description: "替换文件中的指定文本。参数: file_path (文件路径), old_text (要替换的原文——必须精确匹配), new_text (新文本), replace_all (可选, 是否替换全部匹配, 默认false)。用于定向修复编译错误，无需读完整文件。",
      level: 2,
      parameters: { type: "object", properties: { file_path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" }, replace_all: { type: "boolean" } }, required: ["file_path", "old_text", "new_text"] },
      required: ["file_path", "old_text", "new_text"]}});

  const board = new TaskBoard();
  const pool = new AgentPool();
  const scheduler = new Scheduler(board, pool, observer);
  scheduler.setSkillExecutor(skillExecutor);

  // 注册 Agent 类型到 AgentPool（Scheduler 据此匹配 task→agent）
  pool.register({ type: AgentType.Fix, maxInstances: 1 });
  pool.register({ type: AgentType.Review, maxInstances: 1 });
  pool.register({ type: AgentType.Analysis, maxInstances: 1 });
  pool.register({ type: AgentType.DocGovern, maxInstances: 1 });
  pool.register({ type: AgentType.Loop, maxInstances: 1 });
  pool.register({ type: AgentType.Api, maxInstances: 1 });
  pool.register({ type: AgentType.Data, maxInstances: 1 });
  pool.register({ type: AgentType.Strategist, maxInstances: 2 });

  // 执行层 Agent（reAct 策略默认，不指定 preferredStrategy）
  const fixConfig: AgentFactoryConfig = { type: AgentType.Fix, systemPrompt: FIX_PROMPT, maxLoops: 15 };
  const fixAgent = createAgent(fixConfig, chatAdapter, toolkit); await fixAgent.wakeup();
  scheduler.register(AgentType.Fix, fixAgent, llmCfg.chatModel);
  pass("希格雯 (Fix) 就绪");

  const reviewConfig: AgentFactoryConfig = { type: AgentType.Review, systemPrompt: REVIEW_PROMPT, maxLoops: 5 };
  const reviewAgent = createAgent(reviewConfig, chatAdapter, toolkit); await reviewAgent.wakeup();
  scheduler.register(AgentType.Review, reviewAgent, llmCfg.chatModel);
  pass("刻晴 (Review) 就绪");

  const analysisConfig: AgentFactoryConfig = { type: AgentType.Analysis, systemPrompt: ANALYSIS_PROMPT, maxLoops: 6 };
  const analysisAgent = createAgent(analysisConfig, chatAdapter, toolkit); await analysisAgent.wakeup();
  scheduler.register(AgentType.Analysis, analysisAgent, llmCfg.chatModel);
  pass("纳西妲 (Analysis) 就绪");

  const governConfig: AgentFactoryConfig = { type: AgentType.DocGovern, systemPrompt: GOVERN_PROMPT, maxLoops: 3 };
  const governAgent = createAgent(governConfig, chatAdapter, toolkit); await governAgent.wakeup();
  scheduler.register(AgentType.DocGovern, governAgent, llmCfg.chatModel);
  pass("凝光 (DocGovern) 就绪");

  const loopConfig: AgentFactoryConfig = { type: AgentType.Loop, systemPrompt: LOOP_PROMPT, maxLoops: 3 };
  const loopAgent = createAgent(loopConfig, chatAdapter, toolkit); await loopAgent.wakeup();
  scheduler.register(AgentType.Loop, loopAgent, llmCfg.chatModel);
  pass("莫娜 (Loop) 就绪");

  const apiConfig: AgentFactoryConfig = { type: AgentType.Api, systemPrompt: API_PROMPT, maxLoops: 3 };
  const apiAgent = createAgent(apiConfig, chatAdapter, toolkit); await apiAgent.wakeup();
  scheduler.register(AgentType.Api, apiAgent, llmCfg.chatModel);
  pass("久岐忍 (Api) 就绪");

  const dataConfig: AgentFactoryConfig = { type: AgentType.Data, systemPrompt: DATA_PROMPT, maxLoops: 3 };
  const dataAgent = createAgent(dataConfig, chatAdapter, toolkit); await dataAgent.wakeup();
  scheduler.register(AgentType.Data, dataAgent, llmCfg.chatModel);
  pass("艾尔海森 (Data) 就绪");

  // 战略双柱（reasoner 模型）
  const strategyConfig: AgentFactoryConfig = { type: AgentType.Strategist, systemPrompt: STRATEGY_PROMPT, maxLoops: 3 };
  const strategistAgent = createAgent(strategyConfig, reasonerAdapter, toolkit); await strategistAgent.wakeup();
  scheduler.register(AgentType.Strategist, strategistAgent, llmCfg.reasonerModel);
  pass("钟离 (Strategist·契约) 就绪");

  const directionConfig: AgentFactoryConfig = { type: AgentType.Strategist, systemPrompt: DIRECTION_PROMPT, maxLoops: 3 };
  const directionAgent = createAgent(directionConfig, reasonerAdapter, toolkit); await directionAgent.wakeup();
  scheduler.register(AgentType.Strategist, directionAgent, llmCfg.reasonerModel);
  pass("霜凝 (Strategist·方向监理) 就绪");

  // ── Phase 2: 甘雨 (MetaAgent) 自主规划 ──
  //    策略不定: 甘雨自行决定任务拆解方式
  //    调度不定: Scheduler 按拓扑排序自主分派，Agent 按标签认领
  header("Phase 2 — 甘雨战术规划（策略不定·调度不定 | 目标: e2e 编译通过）");

  const metaAgent = new MetaAgent(chatAdapter, skillRegistry);

  const COLLAB_INTENT = [
    "你是甘雨，Cortex 战术中枢。请根据以下意图自主拆解任务。",
    "",
    "**背景**：Cortex monorepo，packages/engine/src/ 是源码（只读），",
    "packages/engine/tests/manual/e2e/ 下的 11 个 .ts 文件是待修复的 e2e 测试（可修改）。",
    "",
    "当前运行 npx tsc --noEmit 发现多个编译错误在这些 e2e 文件中，",
    "原因是它们引用的 @cortex/engine API 在代码演进中发生变更（导入路径变化、类型重命名、函数签名变更等）。",
    "",
    "e2e 文件列表：",
    "  all-agents-smoke.ts, calculator-e2e.ts, closed-loop-collab.ts,",
    "  e2e-real-llm.ts, governance-amendment-e2e.ts, governance-full-agent-e2e.ts,",
    "  mini-react-test.ts, multi-agent-collab-e2e.ts, pipeline-strategy-e2e.ts,",
    "  skill-fix-e2e.ts, solo-flight.ts",
    "",
    "**意图**：组织团队修复所有 e2e 文件的 TypeScript 编译错误，使 npx tsc --noEmit 零报错。不需要运行测试。",
    "",
    "**硬约束**：",
    "1. 源码 src/ 只读，不可修改",
    "2. 仅允许修改 tests/manual/e2e/ 下的 .ts 文件",
    "3. 不要改变测试逻辑，只修复编译期问题（导入、类型、接口对齐）",
    "4. 修复后运行 npx tsc --noEmit 验证",
    "",
    "**可用团队**（均已就绪，按标签认领任务）：",
    "- 希格雯 (FixAgent) —— 唯一有写文件权限，负责修复编译错误。maxLoops=12",
    "- 纳西妲 (AnalysisAgent) —— 只读分析，扫描所有 e2e 文件，统计 API 引用与 engine 实际导出差异。maxLoops=6",
    "- 刻晴 (ReviewAgent) —— 审查修复后导入和类型是否正确。maxLoops=5",
    "- 凝光 (DocGovernAgent) —— 审计修复是否只改了编译问题。maxLoops=3",
    "- 钟离 (StrategistAgent) —— 契约审查：修复后的 e2e 是否遵守 engine 公开 API。maxLoops=3",
    "- 霜凝 (StrategistAgent) —— 方向监理。maxLoops=3",
    "- 莫娜 (LoopAgent) —— 模式识别。maxLoops=3",
    "- 久岐忍 (ApiAgent) —— API 契约校验。maxLoops=3",
    "- 艾尔海森 (DataAgent) —— 数据完整性检查。maxLoops=3",
    "",
    "**可参考技能**：skill-e2e-compilation-fix（E2E编译修复模板：tsc --noEmit→read_file→分析→write_file→tsc --noEmit 验证）",
    "",
    "**策略建议**：",
    "- 先让纳西妲只读扫描所有 e2e 文件 + engine 导出，产出 API 差异报告",
    "- 希格雯根据差异报告批量修复（优先修复导入路径和类型引用）",
    "- 刻晴、凝光、钟离等并行审查",
    "- 节点数 6-12 个，不要膨胀",
    "- 输出 JSON TaskNode 数组",
  ].join("\n");

  console.log("   📋 甘雨思考中（分析→规划→拆解任务）...\n");
  const planStart = Date.now();
  let plan: TaskNode[];
  try {
    plan = await metaAgent.plan(COLLAB_INTENT, {
      existingTags: ["analysis", "fix", "review", "doc-govern", "strategy", "loop", "api", "data"]});
  } catch (e) {
    console.error(`   ❌ MetaAgent 规划失败: ${String(e).slice(0, 300)}`);
    // 兜底：手动投放分析+修复节点
    console.log("   ⚠️ 启用兜底方案（手动投放任务）...");
    plan = [];
  }

  const planDuration = Date.now() - planStart;

  if (plan.length === 0) {
    // ── 兜底：如果 MetaAgent 规划失败/空，手动投放基础任务 ──
    console.log("   ⚠️ MetaAgent 产出为空，使用兜底任务集");
    const fallbackNodes: TaskNode[] = [
      {
        id: "fb-analysis", type: "analysis", tags: ["analysis", "research"] as Tag[],
        needsMultiPerspective: false, status: "pending", claimedBy: [], results: [], createdAt: Date.now(),
        payload: [
          "扫描所有 e2e 文件：列出 packages/engine/tests/manual/e2e/ 下 11 个 .ts 文件",
          "统计每个文件引用的 @cortex/engine API（导入符号）",
          "对比当前 engine 实际导出的 API（查看 packages/engine/src/index.ts）",
          "输出差异报告：哪些导入已过时、哪些 API 名称/签名已变更",
        ].join("\n")},
      {
        id: "fb-fix-imports", type: "fix", tags: ["fix", "typescript"] as Tag[],
        needsMultiPerspective: false, status: "pending", claimedBy: [], results: [], createdAt: Date.now(),
        payload: [
          "根据纳西妲的 API 差异报告，修复所有 e2e 文件的编译错误。",
          "优先修复：过时导入路径、缺失的导入、类型名称变更、函数签名变更。",
          "每次修改后运行 npx tsc --noEmit 验证，逐步清零编译错误。",
          "只改 tests/manual/e2e/ 下的文件，不改 src/。",
        ].join("\n")},
      {
        id: "fb-fix-remaining", type: "fix", tags: ["fix", "typescript"] as Tag[],
        needsMultiPerspective: false, status: "pending", claimedBy: [], results: [], createdAt: Date.now(),
        payload: [
          "修复 fb-fix-imports 未覆盖的残余编译错误。",
          "逐个文件 read_file → 对照 engine 源码 → write_file 修复。",
          "运行 npx tsc --noEmit 确认零报错。",
        ].join("\n")},
      {
        id: "fb-review", type: "review", tags: ["review", "audit"] as Tag[],
        needsMultiPerspective: false, status: "pending", claimedBy: [], results: [], createdAt: Date.now(),
        payload: "审查所有修复过的 e2e 文件：核对导入是否正确、类型是否匹配、是否改变了测试逻辑。"},
    ];
    plan = fallbackNodes;
  } else {
    console.log(`   ✅ 甘雨产出 ${plan.length} 个任务节点 (${planDuration}ms):`);
    for (const n of plan) {
      const parent = n.parentId ? ` ← child of [${n.parentId.slice(0, 20)}]` : " ← root";
      console.log(`      [${n.type}] ${n.id.slice(0, 50)}${parent}  tags: [${(n.tags ?? []).join(", ")}]`);
    }
  }

  for (const n of plan) board.addNode(n);
  pass(`${plan.length} 个节点已入 TaskBoard`);

  // ── Phase 3: Scheduler 一次自主执行 ──
  header("Phase 3 — Scheduler 自主执行（十人按标签认领·拓扑排序）");

  console.log(`   TaskBoard 待执行: ${board.getPendingNodes().map(n => n.id.slice(0, 30)).join(", ")}\n`);

  const execStart = Date.now();
  const report = await scheduler.executeAll();
  const execElapsed = Date.now() - execStart;

  console.log(`\n  完成: ${report.completed}  ✓  |  失败: ${report.failed}  ✗  |  耗时: ${execElapsed}ms\n`);

  // 逐节点展示
  const allNodes = board.getAllNodes();
  for (const n of allNodes) {
    const icon = n.status === "done" ? "✅" : n.status === "failed" ? "❌" : "⏳";
    console.log(`   ${icon} [${n.type}] ${n.id.slice(0, 50)} (${n.status})`);
    for (const r of n.results) {
      const preview = (r.output ?? r.error ?? "?").slice(0, 180).replace(/\n/g, " ");
      console.log(`      ${r.success ? "✅" : "❌"} ${preview}`);
    }
  }
  console.log();

  // 技能反馈闭环
  skillExecutor.recordFeedback(TEST_FIX_SKILL.id, report.failed === 0);
  const skill = skillRegistry.get(TEST_FIX_SKILL.id)!;
  log("技能 feedback", `adoptionCount=${skill.adoptionCount}  (failed=${report.failed})`);

  // ── 审查层结果汇总（不单独做 Phase，已由 Scheduler 在一次执行里搞定）
  const reviewTypes = ["review", "doc-govern", "strategy", "loop", "api", "data"];
  const reviewNodes = allNodes.filter(n => reviewTypes.includes(n.type));
  if (reviewNodes.length > 0) {
    log("审查层结果", `${reviewNodes.filter(n => n.status === "done").length}/${reviewNodes.length} 通过`);
  }

  // ── Phase 4: 记忆诊断 ──
  header("Phase 4 — 记忆系统诊断");

  const allMem = await memory.read({});
  const episodic = allMem.filter((m: any) => m.kind === "TaskLog");
  const conceptual = allMem.filter((m: any) => m.kind === "Insight");
  log("总记忆", `${allMem.length} 条 (episodic=${episodic.length}, conceptual=${conceptual.length})`);
  log("技能 adoptionCount", `${skillRegistry.get(TEST_FIX_SKILL.id)!.adoptionCount}`);

  // ── 最终验证: tsc --noEmit --project tsconfig.test.json（包含 tests/ 目录）──
  header("最终验证 — npx tsc --noEmit --project tsconfig.test.json");

  const engineDir = path.join(WORKSPACE, "packages", "engine");

  try {
    const { execSync } = await import("node:child_process");
    const out = execSync("npx tsc --noEmit --project tsconfig.test.json", {
      cwd: engineDir, timeout: 120_000, encoding: "buffer", maxBuffer: 2 * 1024 * 1024});
    console.log(`\n  编译: ✅ 零报错`);
    console.log(`\n${SEP}\n  🎉 十人协作全链路验证通过！所有 e2e 文件编译成功\n${SEP}\n`);
  } catch (e: any) {
    // execSync 抛异常时，stderr/stdout 可能是 Buffer
    const toStr = (b: any) => (b instanceof Buffer ? b.toString("utf-8") : String(b ?? ""));
    const errText = toStr(e.stderr) + toStr(e.stdout);
    const allErrLines = errText.split("\n").filter((l: string) => l.includes("error TS"));
    const e2eErrLines = allErrLines.filter((l: string) => l.includes("tests/manual/e2e/"));
    console.log(`\n  编译: ❌ ${allErrLines.length} 个 TS 错误 (其中 e2e: ${e2eErrLines.length})`);
    const errPreview = e2eErrLines.slice(0, 25).join("\n");
    if (errPreview) console.log(`\n  e2e 错误摘要:\n${errPreview}`);
    console.log(`\n${SEP}\n  ⚠️ 仍需修复 ${e2eErrLines.length} 个 e2e 编译错误\n${SEP}\n`);
  }
}

main().catch((err) => {
  console.error("💥 E2E 崩溃:", err);
  process.exit(1);
});
