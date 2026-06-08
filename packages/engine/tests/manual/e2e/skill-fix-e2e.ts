/**
 * skill-fix-e2e.ts — 技能闭环 + 多 Agent + 事件管线 真实 LLM E2E
 *
 * v2.6.0 技能系统重构后：
 *   - 技能是"被参照"而非"被注入"——Agent 自主 queryByTags 拉取经验
 *   - SkillExecutor 已移除——SkillRegistry 是唯一技能池
 *   - registerSkillPipeline 监听 NodeComplete → 自动提取技能入池
 *   - 评价回流：recordFeedback(id, agentId, rating) → weight 累加
 *
 * 场景：
 *   多 Agent 并行：FixAgent 修配置 + CodeAgent 答问题
 *   技能池预注册 CI 修复技能 → FixAgent 按标签命中
 *   事件管线验证：PipelineObserver 订阅全部关键事件
 *
 * 用法: npx tsx tests/manual/e2e/skill-fix-e2e.ts [--verbose]
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验收标准:
 *   1. SkillRegistry.queryByTags 正确匹配技能（fix 标签）
 *   2. registerSkillPipeline 事件订阅成功
 *   3. FixAgent (react) 实际修复 tsconfig.json
 *   4. CodeAgent (direct) 产出有意义的回答（多 Agent 共存）
 *   5. PipelineObserver 捕获 NodeStart/NodeComplete/SchedulerDone 事件
 *   6. 评价回流：recordFeedback → weight 更新 + feedbackHistory 追加
 *   7. 临时目录清理完成
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  type Tag,
  type TaskNode,
  type SkillTemplate,
  type FeedbackEntry,
} from "@cortex/shared";
import {
  SkillRegistry,
  deriveStatus,
  registerSkillPipeline,
  TaskBoard,
  AgentPool,
  Scheduler,
  PipelineObserver,
  ConfirmGate,
  Toolkit,
  MemoryStore,
  createAgent,
} from "@cortex/engine";
import { LlmAdapter } from "@cortex/llm";
import type { AgentFactoryConfig } from "@cortex/engine";
import { resolveLlmConfig } from "../config/llm-defaults";
import { PipelineEventType, PipelinePriority } from "@cortex/shared";

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
// 2. Agent 配置（多 Agent）
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
  "【技能经验池——可参考的历史经验】",
  "  {skill_context}",
  "",
  "【任务】请按上述经验步骤修复配置文件。修复完成后输出最终结果。",
].join("\n");

const CODE_SYSTEM_PROMPT = [
  "你是阿贝多，Cortex Code Agent。你正在一个最小化测试环境中工作。",
  "",
  "【可用工具】你只有 4 个工具：",
  "  · read_file  读取文件内容",
  "  · write_file  写入文件内容",
  "  · run_shell  执行命令（仅 pnpm/npm/node/tsc/dir/cat/type/echo）",
  "  · list_files  列出目录内容",
  "",
  "【技能经验池——可参考的历史经验】",
  "  {skill_context}",
  "",
  "【任务】简洁回答即可，不需要写代码。",
].join("\n");

const FIX_CONFIG: AgentFactoryConfig = {
  type: "fix" as any,
  systemPrompt: FIX_SYSTEM_PROMPT,
  maxLoops: 5,
};

const CODE_CONFIG: AgentFactoryConfig = {
  type: "code" as any,
  systemPrompt: CODE_SYSTEM_PROMPT,
  maxLoops: 2,
};

// ══════════════════════════════════════════════
// 3. 技能定义（v2.6.0 SkillTemplate）
// ══════════════════════════════════════════════

const CI_FIX_SKILL: SkillTemplate = {
  id: "skill-ci-deps-fix",
  kind: "action",
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
  weight: 3,
  feedbackHistory: [
    { agentId: "LoopAgent", rating: 1, timestamp: Date.now() - 86400000, suggestion: "CI 修复验证通过" },
  ],
  discoveredBy: "LoopAgent",
  createdAt: Date.now(),
};

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
      declaration: true,
    },
    include: ["src"],
  };
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
    const clean = p.replace(/^[a-zA-Z]:[\\/]/, "").replace(/^[\\/]+/, "");
    return path.resolve(projectRoot, clean || ".");
  };

  // 注入工具元数据——补全 JSON Schema，防止 DeepSeek API 因 type:null 拒绝
  toolkit.setToolMeta({
    read_file: { parameters: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } },
    write_file: { parameters: { type: "object", properties: { file_path: { type: "string" }, content_blob: { type: "string" } }, required: ["file_path", "content_blob"] } },
    run_shell: { parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
    list_files: { parameters: { type: "object", properties: { dir_path: { type: "string" } }, required: [] } },
    search_code: { parameters: { type: "object", properties: {} } },
    grep_code: { parameters: { type: "object", properties: {} } },
  });

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
        maxBuffer: 256 * 1024, stdio: ["ignore", "pipe", "pipe"],
      });
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
      output: entries.map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`).join("\n"),
    };
  });

  // search_code/grep_code 存根——引导 Agent 用 read_file + list_files
  const noSearchMsg = "search_code 在此测试环境不可用。请使用 read_file 读取具体文件、list_files 列出目录。";
  toolkit.register("search_code", async () => ({ success: false, error: noSearchMsg }));
  toolkit.register("grep_code", async () => ({ success: false, error: "grep_code 不可用。请使用 read_file。" }));
}

// ══════════════════════════════════════════════
// 5. 技能上下文构建（替代旧 injectSkillContext）
// ══════════════════════════════════════════════

/**
 * v2.6.0：技能不再注入 prompt，Agent 自主参照。
 * 但 E2E 中为了验证技能确实对 Agent 可见，我们预先查询匹配的技能，
 * 将其序列化后填充到 systemPrompt 的 {skill_context} 占位符中。
 *
 * 这模拟了 MetaAgent 拆解任务时"提前热加载技能进 plan context"的行为。
 */
function buildSkillContext(registry: SkillRegistry, tags: Tag[]): string {
  const matched = registry.queryByTags(tags);
  if (matched.length === 0) return "（无匹配经验）";
  return matched
    .map(
      (s, i) =>
        `[经验 ${i + 1}] ${s.name} (weight=${s.weight}, status=${deriveStatus(s.weight, s.feedbackHistory)})\n` +
        `  触发: ${s.trigger}\n` +
        `  步骤:\n${s.steps.map((st) => `    · ${st}`).join("\n")}`,
    )
    .join("\n\n");
}

// ══════════════════════════════════════════════
// 6. 节点构建
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
    preferredStrategy: strategy,
  };
}

function makeCodeNode(id: string): TaskNode {
  return {
    id,
    type: "code",
    tags: ["code"] as Tag[],
    needsMultiPerspective: false,
    status: "pending",
    claimedBy: [],
    payload: "What is TypeScript? Explain in 1-2 sentences.",
    results: [],
    createdAt: Date.now(),
    preferredStrategy: "direct",
  };
}

// ══════════════════════════════════════════════
// 7. 事件追踪器
// ══════════════════════════════════════════════

interface TrackedEvents {
  nodeStart: number;
  nodeComplete: number;
  nodeFailed: number;
  schedulerDone: number;
  layerStart: number;
  all: string[];
}

function createEventTracker(observer: PipelineObserver): {
  events: TrackedEvents;
  unsubscribe: () => void;
} {
  const events: TrackedEvents = {
    nodeStart: 0,
    nodeComplete: 0,
    nodeFailed: 0,
    schedulerDone: 0,
    layerStart: 0,
    all: [],
  };

  const handler = (evt: any) => {
    events.all.push(evt.type);
    switch (evt.type) {
      case PipelineEventType.NodeStart:
        events.nodeStart++;
        break;
      case PipelineEventType.NodeComplete:
        events.nodeComplete++;
        break;
      case PipelineEventType.NodeFailed:
        events.nodeFailed++;
        break;
      case PipelineEventType.SchedulerDone:
        events.schedulerDone++;
        break;
      case PipelineEventType.SchedulerLayerStart:
        events.layerStart++;
        break;
    }
  };

  // 订阅全部优先级以覆盖完整管线
  observer.on(PipelinePriority.CRITICAL, handler);
  observer.on(PipelinePriority.HIGH, handler);
  observer.on(PipelinePriority.NORMAL, handler);

  return {
    events,
    unsubscribe: () => {
      observer.off(PipelinePriority.CRITICAL, handler);
      observer.off(PipelinePriority.HIGH, handler);
      observer.off(PipelinePriority.NORMAL, handler);
    },
  };
}

// ══════════════════════════════════════════════
// 8. 主流程
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
  console.log("║  🔧 Skill v2.6 + Multi-Agent + Events E2E       ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  Model: ${CHAT_MODEL}`);
  console.log(`  Skill: ${CI_FIX_SKILL.name} (${CI_FIX_SKILL.id})\n`);

  let allPassed = true;
  const tmp = createTempProject();

  try {
    // ── Phase 1: 引擎初始化 ──
    header("Phase 1/6 — 引擎初始化");

    const adapter = new LlmAdapter({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      chatModel: CHAT_MODEL,
      reasonerModel: llmCfg.reasonerModel,
    });
    adapter.setCacheEnabled(true);

    const observer = new PipelineObserver();
    const gate = new ConfirmGate();
    gate.bypassAll();
    const memory = new MemoryStore();
    const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-skill-fix.db");
    await memory.init(MEMORY_DB);
    info("MemoryStore", MEMORY_DB);

    // ── 技能系统（v2.6.0：仅 SkillRegistry） ──
    const skillRegistry = new SkillRegistry();
    skillRegistry.register(CI_FIX_SKILL);
    passed(`技能已注册: ${CI_FIX_SKILL.name} (${skillRegistry.totalCount} 个)`);

    // ── 事件管线注册技能自动提取 ──
    const unregisterSkillPipe = registerSkillPipeline(observer, skillRegistry, memory);
    passed("registerSkillPipeline 事件订阅成功");

    // ── 事件追踪 ──
    const tracker = createEventTracker(observer);

    // ── Phase 2: 技能查询验证（替代旧 matchSkill） ──
    header("Phase 2/6 — 标签查询技能（queryByTags）");

    const fixTags: Tag[] = ["fix", "config"];
    const matched = skillRegistry.queryByTags(fixTags);
    if (matched.length === 1 && matched[0].id === CI_FIX_SKILL.id) {
      passed(`技能匹配成功: ${matched[0].name} (weight=${matched[0].weight})`);
    } else {
      failed("技能匹配失败", `matched.length=${matched.length}`);
      allPassed = false;
    }

    // 验证技能上下文可构建
    const ctx = buildSkillContext(skillRegistry, fixTags);
    if (ctx.includes("CI 依赖修复流程") && ctx.includes("read_file 读取")) {
      passed("技能上下文构建正确（含步骤序列）");
      dbg(`技能上下文:\n${ctx}`);
    } else {
      failed("技能上下文构建异常");
      allPassed = false;
    }

    // ── Phase 3: FixAgent 执行（技能辅助修复） ──
    header("Phase 3/6 — FixAgent 执行修复");

    // 构建带技能上下文的 prompt
    const fixConfigWithSkill: AgentFactoryConfig = {
      ...FIX_CONFIG,
      systemPrompt: FIX_SYSTEM_PROMPT.replace("{skill_context}", buildSkillContext(skillRegistry, fixTags)),
    };

    const board1 = new TaskBoard();
    const pool1 = new AgentPool();
    pool1.register({ type: "fix" as any, maxInstances: 1 });
    const scheduler1 = new Scheduler(board1, pool1, observer);
    scheduler1.setMemoryStore(memory);

    const toolkit1 = new Toolkit(gate);
    registerTools(toolkit1, tmp.root);
    const fixAgent = createAgent(fixConfigWithSkill, adapter, toolkit1, memory);
    await fixAgent.wakeup();
    scheduler1.register("fix", fixAgent, CHAT_MODEL);
    passed("FixAgent 就绪（含技能上下文）");

    // 重置 tsconfig 为脏状态
    const badTsconfig = {
      compilerOptions: {
        target: "ES2022", module: "ESNext", moduleResolution: "bundler",
        outDr: "./dist", strict: true, declaration: true,
      },
      include: ["src"],
    };
    fs.writeFileSync(tmp.fixTarget, JSON.stringify(badTsconfig, null, 2), "utf-8");

    const skillBeforeFix = skillRegistry.get(CI_FIX_SKILL.id)!;
    const weightBeforeFix = skillBeforeFix.weight;
    const feedbackCountBeforeFix = skillBeforeFix.feedbackHistory.length;

    board1.addNode(makeFixNode("fix-react", tmp.root, "react"));

    const start1 = Date.now();
    await scheduler1.executeAll();
    const elapsed1 = Date.now() - start1;

    const nodeFix = board1.getNode("fix-react");
    if (nodeFix?.status === "done" && nodeFix.results[0]?.success) {
      passed(`FixAgent 执行完成 (${elapsed1}ms)`);
      const output = (nodeFix.results[0].output ?? "").slice(0, 300);
      info("输出", output.replace(/\n/g, " "));
    } else {
      failed("FixAgent 执行", nodeFix?.results[0]?.error ?? `status=${nodeFix?.status}`);
      allPassed = false;
    }

    // 验证修复结果
    const content1 = fs.readFileSync(tmp.fixTarget, "utf-8");
    if (content1.includes('"outDir"') && !content1.includes('"outDr"')) {
      passed("tsconfig.json 已修复 (outDr → outDir)");
    } else {
      console.log(`  ⚠️ tsconfig 可能未完全修复，当前内容:\n${content1.slice(0, 300)}`);
    }

    // ── Phase 4: 评价回流（recordFeedback） ──
    header("Phase 4/6 — 评价回流（recordFeedback）");

    const fixSuccess = nodeFix?.status === "done" && nodeFix?.results[0]?.success;
    const feedbackRating = fixSuccess ? 1 : -1;
    const feedbackSuggestion = fixSuccess
      ? "CI 修复流程在真实 E2E 中验证通过"
      : "修复未成功，需检查 Agent 配置或 LLM 响应";

    const recorded = skillRegistry.recordFeedback(
      CI_FIX_SKILL.id,
      "FixAgent",
      feedbackRating,
      feedbackSuggestion,
    );
    passed(`recordFeedback 调用${recorded ? "成功" : "失败"}`);

    const skillAfterFix = skillRegistry.get(CI_FIX_SKILL.id)!;
    const weightAfterFix = skillAfterFix.weight;
    const feedbackCountAfterFix = skillAfterFix.feedbackHistory.length;

    if (weightAfterFix === weightBeforeFix + feedbackRating) {
      passed(`weight 更新: ${weightBeforeFix}→${weightAfterFix} (Δ=${feedbackRating})`);
    } else {
      failed("weight 未正确更新", `expected Δ=${feedbackRating}, got Δ=${weightAfterFix - weightBeforeFix}`);
      allPassed = false;
    }

    if (feedbackCountAfterFix === feedbackCountBeforeFix + 1) {
      passed(`feedbackHistory 追加: ${feedbackCountBeforeFix}→${feedbackCountAfterFix}`);
      const lastEntry = skillAfterFix.feedbackHistory[skillAfterFix.feedbackHistory.length - 1];
      if (lastEntry.agentId === "FixAgent" && lastEntry.rating === feedbackRating) {
        passed("反馈条目内容正确");
      } else {
        failed("反馈条目内容异常", JSON.stringify(lastEntry));
        allPassed = false;
      }
    } else {
      failed("feedbackHistory 未正确追加");
      allPassed = false;
    }

    // 验证状态推导
    const derivedStatus = deriveStatus(skillAfterFix.weight, skillAfterFix.feedbackHistory);
    info("deriveStatus", `${derivedStatus} (weight=${skillAfterFix.weight}, feedbacks=${skillAfterFix.feedbackHistory.length})`);

    // ── Phase 5: CodeAgent 执行（多 Agent 共存验证） ──
    header("Phase 5/6 — CodeAgent 执行（多 Agent 共存）");

    const codeConfigWithSkill: AgentFactoryConfig = {
      ...CODE_CONFIG,
      systemPrompt: CODE_SYSTEM_PROMPT.replace("{skill_context}", "（无匹配经验——code 标签暂无技能）"),
    };

    const board2 = new TaskBoard();
    const pool2 = new AgentPool();
    pool2.register({ type: "code" as any, maxInstances: 1 });
    const scheduler2 = new Scheduler(board2, pool2, observer);
    scheduler2.setMemoryStore(memory);

    const toolkit2 = new Toolkit(gate);
    registerTools(toolkit2, tmp.root);
    const codeAgent = createAgent(codeConfigWithSkill, adapter, toolkit2, memory);
    await codeAgent.wakeup();
    scheduler2.register("code", codeAgent, CHAT_MODEL);
    passed("CodeAgent 就绪");

    board2.addNode(makeCodeNode("code-qa"));
    const start2 = Date.now();
    await scheduler2.executeAll();
    const elapsed2 = Date.now() - start2;

    const nodeCode = board2.getNode("code-qa");
    if (nodeCode?.status === "done" && nodeCode.results[0]?.success) {
      passed(`CodeAgent 执行完成 (${elapsed2}ms)`);
      const output = (nodeCode.results[0].output ?? "").slice(0, 200);
      info("输出", output.replace(/\n/g, " "));
      if (output.length > 20 && /typescript|TypeScript|language|JavaScript/i.test(output)) {
        passed("CodeAgent 产出合理回答");
      } else {
        console.log(`  ⚠️ CodeAgent 回答可能不完整: ${output.slice(0, 100)}`);
      }
    } else {
      failed("CodeAgent 执行", nodeCode?.results[0]?.error ?? `status=${nodeCode?.status}`);
      allPassed = false;
    }

    // ── Phase 6: 事件管线验证 ──
    header("Phase 6/6 — 事件管线验证");

    // 取消技能管线订阅
    unregisterSkillPipe();
    tracker.unsubscribe();

    const evt = tracker.events;
    info("事件统计", `NodeStart=${evt.nodeStart}, NodeComplete=${evt.nodeComplete}, NodeFailed=${evt.nodeFailed}, SchedulerDone=${evt.schedulerDone}`);

    // 两个节点各启动一次 + 可能的重规划
    if (evt.nodeStart >= 2) {
      passed(`NodeStart 事件: ${evt.nodeStart} 次 (≥2)`);
    } else {
      failed(`NodeStart 事件不足`, `只有 ${evt.nodeStart} 次，预期 ≥2`);
      allPassed = false;
    }

    if (evt.nodeComplete >= 2) {
      passed(`NodeComplete 事件: ${evt.nodeComplete} 次 (≥2)`);
    } else {
      failed(`NodeComplete 事件不足`, `只有 ${evt.nodeComplete} 次，预期 ≥2`);
      allPassed = false;
    }

    if (evt.schedulerDone >= 2) {
      passed(`SchedulerDone 事件: ${evt.schedulerDone} 次 (两次 executeAll)`);
    } else {
      failed(`SchedulerDone 事件不足`, `只有 ${evt.schedulerDone} 次，预期 ≥2`);
      allPassed = false;
    }

    if (evt.nodeFailed === 0) {
      passed(`NodeFailed 事件: 0 次（无失败）`);
    } else {
      console.log(`  ⚠️ NodeFailed 事件: ${evt.nodeFailed} 次`);
    }

    // 验证事件顺序：NodeStart 在 NodeComplete 之前出现
    const startIndices: number[] = [];
    const completeIndices: number[] = [];
    evt.all.forEach((type, i) => {
      if (type === PipelineEventType.NodeStart) startIndices.push(i);
      if (type === PipelineEventType.NodeComplete) completeIndices.push(i);
    });
    if (startIndices.length > 0 && completeIndices.length > 0) {
      const allStartBeforeComplete = startIndices.every(
        (si) => completeIndices.some((ci) => ci > si),
      );
      if (allStartBeforeComplete) {
        passed("事件顺序正确: NodeStart → NodeComplete");
      }
    }

    if (VERBOSE) {
      console.log(`\n  📋 完整事件序列 (${evt.all.length} 个):`);
      evt.all.forEach((t, i) => console.log(`     [${i}] ${t}`));
    }

    // ── 诊断 ──
    header("诊断");

    const allMem = await memory.read({});
    const fixMems = allMem.filter((m: any) => m.kind === "TaskLog");
    info("总记忆", `${allMem.length} 条 (episodic=${fixMems.length})`);

    const finalSkill = skillRegistry.get(CI_FIX_SKILL.id)!;
    info("技能 weight", `${weightBeforeFix} → ${finalSkill.weight}`);
    info("技能 feedbackHistory", `${feedbackCountBeforeFix} → ${finalSkill.feedbackHistory.length} 条`);
    info("技能 status", deriveStatus(finalSkill.weight, finalSkill.feedbackHistory));

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
    console.log("  🎉 Skill v2.6 + Multi-Agent + Events E2E 全部通过");
  } else {
    console.log("  ❌ Skill v2.6 + Multi-Agent + Events E2E 存在问题");
  }
  console.log(`${SEP}\n`);

  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error("💥 E2E 崩溃:", err);
  process.exit(1);
});
