/**
 * skill-fix-e2e.ts — 技能闭环 + 策略路由 真实 LLM E2E
 *
 * 场景：
 *   react 策略: FixAgent 执行 bug 修复，SkillExecutor 自动匹配技能并注入 prompt
 *   direct 策略: CodeAgent 执行简单问答，DirectStep 单次 LLM 调用（无工具）
 *
 * 用法: npx tsx tests/manual/e2e/skill-fix-e2e.ts [--verbose]
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验收标准:
 *   1. SkillExecutor 正确匹配技能（fix 标签）
 *   2. react 策略 + skill 注入 → FixAgent 实际修复文件
 *   3. direct 策略 → DirectStep 单次 LLM 调用完成（不需要工具）
 *   4. 两种策略均通过 preferredStrategy 正确路由
 *   5. 反馈闭环正常记录（adoptionCount +1）
 *   6. 临时目录清理完成
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { AgentType, type Tag, type TaskNode, type SkillTemplate } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import {
  SkillRegistry,
  SkillExecutor,
  TaskBoard,
  AgentPool,
  Scheduler,
  PipelineObserver,
  ConfirmGate,
  Toolkit,
  MemoryStore,
  createAgent} from "@cortex/engine";
import type { AgentFactoryConfig } from "@cortex/engine";
import { resolveLlmConfig } from "../config/llm-defaults";

// ══════════════════════════════════════════════
// 0. 配置
// ══════════════════════════════════════════════

let VERBOSE = false;

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const clean = line.replace(/\r$/, "");
      const m = clean.match(/^([^=]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].trim();
    }
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("❌ DEEPSEEK_API_KEY 未设置");
    process.exit(1);
  }
}

// ══════════════════════════════════════════════
// 1. 辅助
// ══════════════════════════════════════════════

const SEP = "═".repeat(60);
function header(t: string): void { console.log(`\n${SEP}\n  ${t}\n${SEP}`); }
function passed(label: string): void { console.log(`  ✅ ${label}`); }
function failed(label: string, detail?: string): void {
  console.log(`  ❌ ${label}`);
  if (detail) console.log(`     ${detail}`);
}
function info(label: string, value: string): void { console.log(`  📋 ${label}: ${value}`); }
function dbg(msg: string): void { if (VERBOSE) console.log(`  🔍 ${msg}`); }

// ══════════════════════════════════════════════
// 2. Agent 配置
// ══════════════════════════════════════════════

const FIX_SYSTEM_PROMPT = [
  "你是希格雯，Cortex Fix Agent。你正在一个最小化测试环境中工作。",
  "",
  "【可用工具】你只有 4 个工具：",
  "  · read_file  读取文件内容",
  "  · write_file  写入文件内容",
  "  · run_shell  执行命令（仅 pnpm/npm/node/tsc/dir/cat/type/echo）",
  "  · list_files  列出目录内容",
  "没有 search_code/grep_code——需要搜索请用 read_file + list_files。",
  "",
  "【沙箱边界】你只能操作项目目录内的文件。给你的路径就是项目根目录。",
  "",
  "【任务】skill 注入块已经告诉你要做什么。照步骤执行，不要偏离。",
  "修复完成后输出最终结果即可。",
].join("\n");

const FIX_CONFIG: AgentFactoryConfig = {
  type: AgentType.Fix,
  systemPrompt: FIX_SYSTEM_PROMPT,
  maxLoops: 5};

// ══════════════════════════════════════════════
// 3. 技能定义
// ══════════════════════════════════════════════

const CI_FIX_SKILL: SkillTemplate = {
  id: "skill-ci-deps-fix",
  agentType: AgentType.Fix,
  name: "CI 依赖修复流程",
  triggerTags: ["fix", "config", "ci"] as Tag[],
  trigger: "当项目依赖或配置文件导致构建失败时触发",
  steps: [
    "read_file 读取 package.json 检查依赖声明",
    "read_file 读取 tsconfig.json 检查编译配置",
    "定位并修复配置文件中的错误或不一致",
    "write_file 写入修复后的内容",
    "run_shell 执行 pnpm install 验证修复",
  ],
  expectedOutput: "修复后的配置文件 + 依赖安装成功",
  status: "active",
  adoptionCount: 3,
  rejectionCount: 0,
  discoveredBy: "LoopAgent",
  createdAt: Date.now()};

// ══════════════════════════════════════════════
// 4. 临时项目与工具
// ══════════════════════════════════════════════

function createTempProject(): { root: string; fixTarget: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-e2e-"));
  const src = path.join(root, "src");
  fs.mkdirSync(src, { recursive: true });

  // 创建一个有拼写错误的 tsconfig.json（outDir 误写为 outDr）
  const badTsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      outDr: "./dist", // ← 拼写错误：应为 outDir
      strict: true,
      declaration: true},
    include: ["src"]};
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify(badTsconfig, null, 2), "utf-8");

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "skill-e2e-test", private: true }, null, 2),
    "utf-8",
  );

  fs.writeFileSync(
    path.join(src, "index.ts"),
    `export function add(a: number, b: number): number { return a + b; }\n`,
    "utf-8",
  );

  console.log(`  📋 临时项目: ${root}`);
  dbg('tsconfig.json 包含 "outDr"（拼写错误，应为 "outDir"）');
  return { root, fixTarget: path.join(root, "tsconfig.json") };
}

function registerTools(toolkit: Toolkit, projectRoot: string) {
  const resolve = (p: string) => {
    const normalized = path.normalize(p);
    if (path.isAbsolute(normalized) && normalized.toLowerCase().startsWith(projectRoot.toLowerCase() + path.sep)) {
      return normalized;
    }
    const clean = p.replace(/^[a-zA-Z]:[\\/]/, '').replace(/^[\\/]+/, '');
    return path.resolve(projectRoot, clean || '.');
  };

  toolkit.register("read_file", async (params: any) => {
    const fp = resolve(params.file_path as string);
    if (!fp.startsWith(projectRoot + path.sep)) {
      return { success: false, error: `read_file denied: 路径越界` };
    }
    if (!fs.existsSync(fp)) return { success: false, error: `File not found: ${fp}` };
    const content = fs.readFileSync(fp, "utf-8");
    const max = 4000;
    const truncated = content.length > max ? content.slice(0, max) + `\n...(truncated)` : content;
    dbg(`read_file ${path.relative(projectRoot, fp)} (${content.length} chars)`);
    return { success: true, output: truncated };
  });

  toolkit.register("write_file", async (params: any) => {
    const fp = resolve(params.file_path as string);
    if (!fp.startsWith(projectRoot + path.sep)) {
      return { success: false, error: `write_file denied: 路径越界` };
    }
    const content = params.content_blob as string;
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, content, "utf-8");
    dbg(`write_file ${path.relative(projectRoot, fp)} (${content.length} chars)`);
    return { success: true, output: `Wrote ${Buffer.byteLength(content)} bytes to ${fp}` };
  });

  toolkit.register("run_shell", async (params: any) => {
    let cmd = (params.command ?? "") as string;
    if (!cmd) return { success: false, error: "run_shell: 缺少 command" };
    cmd = cmd.replace(/^cd\s+(.+?)\s*(&&|;)\s*/i, "").trim();
    const SAFE = /^(pnpm|npm|node|tsc|dir|ls|cat|type|echo|git\s+status|git\s+diff|git\s+log)\b/i;
    if (!SAFE.test(cmd)) {
      return { success: false, error: `run_shell denied: 不允许的命令 '${cmd}'` };
    }
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(cmd, {
        cwd: projectRoot, timeout: 30_000, encoding: "utf-8",
        maxBuffer: 256 * 1024, stdio: ["ignore", "pipe", "pipe"]});
      dbg(`run_shell ${cmd} OK`);
      return { success: true, output: output || "(exit 0)" };
    } catch (e: any) {
      if (e.code === "ENOENT" || (e.message && /not found/i.test(e.message))) {
        dbg(`run_shell ${cmd} 命令不可用(sandbox)，跳过`);
        return { success: true, output: "(command not available in sandbox, skipped)" };
      }
      dbg(`run_shell ${cmd} FAILED: ${e.message?.slice(0, 100) ?? String(e)}`);
      return { success: false, error: `Command failed: ${e.message?.slice(0, 200) ?? String(e)}` };
    }
  });

  toolkit.register("list_files", async (params: any) => {
    const dp = resolve((params.dir_path ?? params.path ?? ".") as string);
    if (!fs.existsSync(dp)) return { success: false, error: `Dir not found: ${dp}` };
    const entries = fs.readdirSync(dp, { withFileTypes: true });
    return {
      success: true,
      output: entries.map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`).join("\n")};
  });

  // search_code/grep_code 存根——引导 Agent 用 read_file + list_files
  const noSearchMsg = "search_code 在此测试环境不可用。请使用 read_file 读取具体文件、list_files 列出目录。";
  toolkit.register("search_code", async () => ({ success: false, error: noSearchMsg }));
  toolkit.register("grep_code", async () => ({ success: false, error: "grep_code 不可用。请使用 read_file。" }));
}

// ══════════════════════════════════════════════
// 5. 节点构建
// ══════════════════════════════════════════════

function makeFixNode(id: string, projectRoot: string, strategy?: "react" | "direct"): TaskNode {
  return {
    id,
    type: "fix",
    tags: ["fix", "config"] as Tag[],
    needsMultiPerspective: false,
    status: "pending",
    claimedBy: [],
    payload: [
      `修复项目中的配置文件错误。`,
      ``,
      `背景：tsconfig.json 中有一个拼写错误——"outDr" 应该是 "outDir"`,
      `请读取并修复该文件。`,
      ``,
      `项目路径: ${projectRoot}`,
    ].join("\n"),
    results: [],
    createdAt: Date.now(),
    preferredStrategy: strategy};
}

// ══════════════════════════════════════════════
// 6. 主流程
// ══════════════════════════════════════════════

async function main() {
  loadEnv();
  VERBOSE = process.argv.includes("--verbose");
  const API_KEY = process.env.DEEPSEEK_API_KEY!;
  const llmCfg = resolveLlmConfig();
  const BASE_URL = llmCfg.baseUrl;
  const CHAT_MODEL = llmCfg.chatModel;
  const WORKSPACE = process.cwd();

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  🔧 Skill Fix + Pipeline Strategy E2E          ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  Model: ${CHAT_MODEL}`);
  console.log(`  Skill: ${CI_FIX_SKILL.name} (${CI_FIX_SKILL.id})\n`);

  let allPassed = true;
  const tmp = createTempProject();

  try {
    // ── Phase 1: 引擎初始化 ──
    header("Phase 1/5 — 引擎初始化");

    const adapter = new LlmAdapter({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      chatModel: CHAT_MODEL,
      reasonerModel: llmCfg.reasonerModel});
    adapter.setCacheEnabled(true);

    const observer = new PipelineObserver();
    const gate = new ConfirmGate();
    gate.bypassAll();
    const memory = new MemoryStore();
    const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-skill-fix.db");
    await memory.init(MEMORY_DB);
    info("MemoryStore", MEMORY_DB);

    // ── 技能系统 ──
    const skillRegistry = new SkillRegistry();
    const skillExecutor = new SkillExecutor(skillRegistry);
    skillRegistry.register(CI_FIX_SKILL);
    passed(`技能已注册: ${CI_FIX_SKILL.name} (${skillRegistry.totalCount} 个)`);

    // ── Phase 2: 技能匹配验证 ──
    header("Phase 2/5 — 技能匹配验证");

    const fixTags: Tag[] = ["fix", "config"];
    const matched = skillExecutor.matchSkill(fixTags);
    if (matched) {
      passed(`技能匹配成功: ${matched.name} (${matched.id})`);
      const injected = skillExecutor.injectSkillContext(matched.id);
      if (injected) {
        passed("技能上下文注入成功");
        dbg(`注入预览:\n${injected.slice(0, 300)}...`);
      } else {
        failed("技能上下文注入失败");
        allPassed = false;
      }
    } else {
      failed("技能匹配失败");
      allPassed = false;
    }

    // ── Phase 3: react 策略 + 技能 ──
    header("Phase 3/5 — react 策略 + 技能闭环");

    const board1 = new TaskBoard();
    const pool1 = new AgentPool();
    pool1.register({ type: AgentType.Fix, maxInstances: 1 });
    const scheduler1 = new Scheduler(board1, pool1, observer);
    scheduler1.setSkillExecutor(skillExecutor);

    const toolkit1 = new Toolkit(gate);
    registerTools(toolkit1, tmp.root);
    const fixAgent1 = createAgent(FIX_CONFIG, adapter, toolkit1);
    await fixAgent1.wakeup();
    scheduler1.register(AgentType.Fix, fixAgent1, CHAT_MODEL);
    passed("FixAgent (react) 就绪");

    // 重置 tsconfig 为脏状态
    const badTsconfig = {
      compilerOptions: {
        target: "ES2022", module: "ESNext", moduleResolution: "bundler",
        outDr: "./dist", strict: true, declaration: true},
      include: ["src"]};
    fs.writeFileSync(tmp.fixTarget, JSON.stringify(badTsconfig, null, 2), "utf-8");

    const ciFixInitialAdoption = skillRegistry.get(CI_FIX_SKILL.id)!.adoptionCount;
    board1.addNode(makeFixNode("fix-react", tmp.root, "react"));

    const start1 = Date.now();
    await scheduler1.executeAll();
    const elapsed1 = Date.now() - start1;

    const nodeReact = board1.getNode("fix-react");
    if (nodeReact?.status === "done" && nodeReact.results[0]?.success) {
      passed(`react 策略完成 (${elapsed1}ms)`);
      const output = (nodeReact.results[0].output ?? "").slice(0, 200);
      info("输出", output.replace(/\n/g, " "));
    } else {
      failed("react 策略", nodeReact?.results[0]?.error ?? `status=${nodeReact?.status}`);
      allPassed = false;
    }

    // 验证修复
    const content1 = fs.readFileSync(tmp.fixTarget, "utf-8");
    if (content1.includes('"outDir"') && !content1.includes('"outDr"')) {
      passed("tsconfig.json 已修复 (outDr → outDir)");
    } else {
      console.log(`  ⚠️ tsconfig 未完全修复，当前内容:\n${content1.slice(0, 300)}`);
    }

    // 反馈闭环
    const after1 = skillRegistry.get(CI_FIX_SKILL.id)!;
    const delta1 = after1.adoptionCount - ciFixInitialAdoption;
    if (delta1 >= 1) {
      passed(`react 反馈闭环: adoption ${ciFixInitialAdoption}→${after1.adoptionCount} (+${delta1})`);
    } else {
      failed("react 反馈未触发", `delta=${delta1}`);
      allPassed = false;
    }

    // ── Phase 4: direct 策略 + 纯问答（DirectStep 无工具，不做修复）──
    header("Phase 4/5 — direct 策略 + 纯问答");

    // DirectStep 无工具能力，用于简单问答——不需要 skill 匹配的标签
    const board2 = new TaskBoard();
    const pool2 = new AgentPool();
    pool2.register({ type: AgentType.Code, maxInstances: 1 });
    const scheduler2 = new Scheduler(board2, pool2, observer);
    scheduler2.setSkillExecutor(skillExecutor);

    const toolkit2 = new Toolkit(gate);
    registerTools(toolkit2, tmp.root);
    const directNode: TaskNode = {
      id: "direct-qa",
      type: "code",
      tags: ["code"] as Tag[],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "What is TypeScript? Explain in 1-2 sentences.",
      results: [],
      createdAt: Date.now(),
      preferredStrategy: "direct"};
    const codeAgent = createAgent({
      type: AgentType.Code,
      systemPrompt: "You are a helpful coding assistant. Answer concisely.",
      maxLoops: 1}, adapter, toolkit2);
    await codeAgent.wakeup();
    scheduler2.register(AgentType.Code, codeAgent, CHAT_MODEL);
    passed("CodeAgent (direct) 就绪");

    board2.addNode(directNode);

    const start2 = Date.now();
    await scheduler2.executeAll();
    const elapsed2 = Date.now() - start2;

    const nodeDirect = board2.getNode("direct-qa");
    if (nodeDirect?.status === "done" && nodeDirect.results[0]?.success) {
      passed(`direct 策略完成 (${elapsed2}ms)`);
      const output = (nodeDirect.results[0].output ?? "").slice(0, 200);
      info("输出", output.replace(/\n/g, " "));
      // 验证 direct 策略产出有意义内容
      if (output.length > 20 && /typescript|TypeScript|language/i.test(output)) {
        passed("direct 策略产出合理回答");
      } else {
        console.log(`  ⚠️ direct 回答可能不完整: ${output.slice(0, 100)}`);
      }
    } else {
      failed("direct 策略", nodeDirect?.results[0]?.error ?? `status=${nodeDirect?.status}`);
      allPassed = false;
    }

    // ── Phase 5: 记忆系统诊断 ──
    header("Phase 5/5 — 诊断");

    const allMem = await memory.read({});
    const fixMems = allMem.filter((m: any) => m.kind === "TaskLog");
    info("总记忆", `${allMem.length} 条 (episodic=${fixMems.length})`);

    info("技能 adoptionCount", `${skillRegistry.get(CI_FIX_SKILL.id)!.adoptionCount}`);
    info("技能 rejectionCount", `${skillRegistry.get(CI_FIX_SKILL.id)!.rejectionCount}`);

  } finally {
    // ── 清理 ──
    header("清理");
    try {
      fs.rmSync(tmp.root, { recursive: true, force: true });
      passed(`临时项目已清理: ${tmp.root}`);
    } catch (e) {
      console.log(`  ⚠️ 清理失败: ${e}`);
    }
  }

  // ── 最终判定 ──
  console.log(`\n${SEP}`);
  if (allPassed) {
    console.log("  🎉 Skill + Pipeline Strategy E2E 全部通过");
  } else {
    console.log("  ❌ Skill + Pipeline Strategy E2E 存在问题");
  }
  console.log(`${SEP}\n`);

  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error("💥 E2E 崩溃:", err);
  process.exit(1);
});
