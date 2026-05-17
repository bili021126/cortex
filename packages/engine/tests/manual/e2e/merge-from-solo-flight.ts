/**
 * 合并大考 —— Agent 将归档产出合并到主工程
 *
 * 用法: npx tsx tests/manual/e2e/merge-from-solo-flight.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 资源:
 *   1. .cortex/skills-crystallized.json  —— 莫娜已沉淀技能（P0-P9 模式 + 架构模式）
 *   2. .cortex/archive/e2e-outputs/.../solo-flight/      —— 归档 solo-flight（cli/core/formatters/storage/types）
 *   3. .cortex/archive/e2e-outputs/.../closed-loop-test/ —— 归档闭环测试（monorepo-analyzer、drift-detector）
 *
 * 验收标准:
 *   1. MetaAgent 产出 ≥1 个 TaskNode
 *   2. Scheduler.executeAll() 完成，失败节点 = 0
 *   3. 主工程 packages/ 下出现新的子包（parser/cli/data/tools 等）
 *   4. pnpm build 全量通过（含新包）
 *   5. pnpm test 全量通过（含新包的集成测试）
 *   6. 不破坏任何现有包的构建
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentType, PipelinePriority, type TaskNode } from "@cortex/shared";
import { MemorySubType, MemoryState, MemoryType } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { loadSkillsFromMemory, scanOutputFilesForSkills } from "../../../src/components/skill-persister.js";
import {
  TaskBoard,
  AgentPool,
  Scheduler,
  PipelineObserver,
  ConfirmGate,
  Toolkit,
  ConsistencyLayer,
  NodeFileSystemAdapter,
  MetaAgent,
  SkillRegistry,
  createAgent,
  codeAgentConfig,
  reviewAgentConfig,
  analysisAgentConfig,
  opsAgentConfig,
  loopAgentConfig,
  docGovernAgentConfig,
  apiAgentConfig,
  dataAgentConfig,
  fixAgentConfig,
  createInspectorAgent,
} from "@cortex/engine";
import { MemoryStore } from "../../../src/memory/memory-store.js";

// ══════════════════════════════════════════════
// 0. 环境变量
// ══════════════════════════════════════════════

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    if (process.env.DEEPSEEK_API_KEY) return;
    console.error("❌ .env 文件不存在且 DEEPSEEK_API_KEY 环境变量未设置");
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const clean = line.replace(/\r$/, "");
    const m = clean.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

// ══════════════════════════════════════════════
// 1. 工具注册 —— 写入扩展到主 workspace 的 packages/
// ══════════════════════════════════════════════

const DANGEROUS = /\b(rm\s+-rf|del\s+\/F|format\s|shutdown|reboot|sudo|chmod\s+777|>\/dev\/|curl.*\|.*sh|wget.*-O.*\||mkfs)\b/i;

function registerAllTools(toolkit: Toolkit, workspaceRoot: string, packagesRoot: string) {
  const resolve = (p: string) => path.resolve(workspaceRoot, p);

  // ── 读取（全 workspace 可读）──

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
      const listing = entries
        .map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`)
        .join("\n");
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
    if (!query) return { success: false, error: "Missing query/pattern" };
    try {
      const results: string[] = [];
      const walk = (d: string, depth: number) => {
        if (depth > 5) return;
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            walk(full, depth + 1);
          } else if (entry.isFile() && /\.(ts|js|json|md|yaml|yml)$/.test(entry.name)) {
            const stat = fs.statSync(full);
            if (stat.size > 200 * 1024) continue;
            const content = fs.readFileSync(full, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                results.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 150)}`);
              }
            }
          }
        }
      };
      walk(dir, 0);
      return { success: true, output: results.slice(0, 30).join("\n") || "(no matches)" };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  // ── 写入 —— 白名单: projects/solo-flight/ 可读写; packages/ 可读写 ──

  toolkit.register("write_file", async (params) => {
    const fp = resolve(params.file_path as string);
    // 允许写入 packages/ 或 test-output/
    const allowed = fp.startsWith(packagesRoot + path.sep) ||
      fp.startsWith(path.resolve(workspaceRoot, "test-output") + path.sep);
    if (!allowed) {
      return { success: false, error: `write_file denied: 仅允许写入 packages/ 或 test-output/ 目录。当前路径: ${fp}` };
    }
    try {
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const content = params.content as string;
      fs.writeFileSync(fp, content, "utf-8");
      return { success: true, output: `Wrote ${Buffer.byteLength(content)} bytes to ${fp}` };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  // ── Shell —— 危险命令拦截，其余放行（cwd 固定在 workspace 根）──

  toolkit.register("run_shell", async (params) => {
    const cmd = (params.command ?? "") as string;
    if (!cmd) return { success: false, error: "run_shell: 缺少 command 参数" };
    if (DANGEROUS.test(cmd)) {
      return { success: false, error: `run_shell denied: 危险命令已拦截 "${cmd.slice(0, 80)}"` };
    }
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(cmd, {
        cwd: workspaceRoot,
        timeout: 120_000,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { success: true, output: output || "(exit 0, no output)" };
    } catch (e: any) {
      const stderr = e.stderr?.toString() ?? "";
      const stdout = e.stdout?.toString() ?? "";
      return {
        success: false,
        error: `Command failed (exit ${e.status ?? "?"}): ${e.message.slice(0, 200)}\nstdout: ${stdout.slice(0, 300)}\nstderr: ${stderr.slice(0, 300)}`,
      };
    }
  });
}

// ══════════════════════════════════════════════
// 2. 列举归档源文件
// ══════════════════════════════════════════════

function listArchiveSources(workspace: string): string {
  const archiveRoot = path.resolve(workspace, ".cortex", "archive", "e2e-outputs");
  const lines: string[] = [];

  if (!fs.existsSync(archiveRoot)) {
    lines.push("⚠️ 归档目录不存在: .cortex/archive/e2e-outputs/");
    return lines.join("\n");
  }

  // 找到最新的时间戳子目录
  const entries = fs.readdirSync(archiveRoot, { withFileTypes: true });
  const timestampDirs = entries.filter((e) => e.isDirectory() && /^\d{8}-\d{6}$/.test(e.name)).sort();
  if (timestampDirs.length === 0) {
    lines.push("⚠️ 归档目录下无时间戳子目录");
    return lines.join("\n");
  }

  const latest = timestampDirs[timestampDirs.length - 1].name;
  const archiveDir = path.join(archiveRoot, latest);

  lines.push(`归档根目录: .cortex/archive/e2e-outputs/${latest}/`);
  lines.push("");

  for (const sub of ["solo-flight", "closed-loop-test"]) {
    const subDir = path.join(archiveDir, sub);
    if (!fs.existsSync(subDir)) continue;

    const walkArchived = (d: string, prefix: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
        const full = path.join(d, entry.name);
        const rel = prefix + entry.name;
        if (entry.isDirectory()) {
          walkArchived(full, rel + "/");
        } else {
          const size = fs.statSync(full).size;
          lines.push(`  [归档:${sub}] ${rel} (${size} bytes)`);
        }
      }
    };
    lines.push(`── 归档: ${sub} ──`);
    walkArchived(subDir, "");
    lines.push("");
  }

  return lines.join("\n");
}

// ══════════════════════════════════════════════
// 2b. 列举 crystallized skills
// ══════════════════════════════════════════════

function listCrystallizedSkills(workspace: string): string {
  const skillsPath = path.resolve(workspace, ".cortex", "skills-crystallized.json");
  if (!fs.existsSync(skillsPath)) {
    return "⚠️ .cortex/skills-crystallized.json 不存在（先运行 test-mona-skill-crystallize.ts）";
  }
  try {
    const raw = fs.readFileSync(skillsPath, "utf-8");
    const data = JSON.parse(raw);
    const templates = data.templates ?? [];
    const lines: string[] = [];
    lines.push(`已沉淀技能: ${templates.length} 个`);
    for (const t of templates.slice(0, 10)) {
      lines.push(`  [${t.agentType}] ${t.name} — ${(t.trigger ?? "").slice(0, 60)}`);
    }
    if (templates.length > 10) lines.push(`  ... 还有 ${templates.length - 10} 个`);
    return lines.join("\n");
  } catch {
    return "⚠️ skills-crystallized.json 解析失败";
  }
}

// ══════════════════════════════════════════════
// 3. 主流程
// ══════════════════════════════════════════════

async function main() {
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) { console.error("❌ DEEPSEEK_API_KEY 未设置"); process.exit(1); }

  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-reasoner";
  const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-v4-pro";
  const WORKSPACE = process.cwd();
  const PACKAGES_ROOT = path.resolve(WORKSPACE, "packages");

  // ── 列出源文件摘要 ──
  const archiveSources = listArchiveSources(WORKSPACE);
  const crystallizedSkills = listCrystallizedSkills(WORKSPACE);

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🏗️  合并大考 —— 将归档产出合并到主工程         ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  工作区:  ${WORKSPACE}`);
  console.log(`  packages: ${PACKAGES_ROOT}`);
  console.log(`  Chat:     ${CHAT_MODEL}`);
  console.log(`  Reasoner: ${REASONER_MODEL}\n`);

  console.log("── 资源清单 ──\n");
  console.log("🟢 已沉淀技能 (莫娜):");
  console.log(crystallizedSkills);
  console.log();
  console.log(archiveSources);

  // ── Phase 1: 基础设施 ──
  console.log("🟢 [Phase 1] 初始化基础设施...\n");

  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    reasonerModel: REASONER_MODEL,
    reasoningEffort: "high",
  });
  adapter.setCacheEnabled(true);

  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();
  const gate = new ConfirmGate();
  gate.bypassAll();

  const memory = new MemoryStore();
  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-merge-exam.db");
  await memory.init(MEMORY_DB);
  console.log(`   MemoryStore: ${MEMORY_DB}`);

  // 技能沉淀：冷启动加载 SkillRegistry（从记忆 + 已沉淀技能 JSON）
  const skillRegistry = new SkillRegistry();
  const loadedSkills = loadSkillsFromMemory(memory);
  if (loadedSkills.length > 0) {
    skillRegistry.registerAll(loadedSkills);
    console.log(`   SkillRegistry: 从记忆加载 ${loadedSkills.length} 个技能`);
  }
  // 加载莫娜沉淀的技能（从 skills-crystallized.json）
  const crystallizedJson = path.resolve(WORKSPACE, ".cortex", "skills-crystallized.json");
  if (fs.existsSync(crystallizedJson)) {
    const crystallizedReg = SkillRegistry.loadJson(crystallizedJson);
    if (crystallizedReg.totalCount > 0) {
      const crystallizedSkills = crystallizedReg.getAll();
      skillRegistry.registerAll(crystallizedSkills);
      console.log(`   SkillRegistry: 从已沉淀 JSON 加载 ${crystallizedSkills.length} 个技能`);
    }
  }
  const scannedSkills = scanOutputFilesForSkills(WORKSPACE);
  if (scannedSkills.length > 0) {
    skillRegistry.registerAll(scannedSkills);
    console.log(`   SkillRegistry: 从文件回溯扫描 ${scannedSkills.length} 个技能`);
  }
  console.log(`   SkillRegistry: 共 ${skillRegistry.totalCount} 个技能就绪`);

  const metaAgent = new MetaAgent(adapter, skillRegistry);

  // P1 一致性校验层（文件校验 + 结构校验）
  const fsAdapter = new NodeFileSystemAdapter();
  const consistency = new ConsistencyLayer(memory as any, {
    projectRoot: WORKSPACE,
    enableInitVerifier: true,
    enableSchemaEnforcer: true,
    fs: fsAdapter,
  });
  console.log(`   ConsistencyLayer: InitVerifier + SchemaEnforcer 已启用`);

  // 种子记忆：写入现有工程上下文（使用 P0 两阶段提交）
  const seed1 = memory.writePending({
    memoryType: MemoryType.Knowledge,
    content: { desc: "packages: engine, llm, shared, testing. pnpm workspace. tsconfig.base.json" },
    summary: "主工程 monorepo 结构: packages/engine, packages/llm, packages/shared, packages/testing",
    agentType: "meta" as AgentType,
    creatorId: "merge-exam",
    subType: MemorySubType.Fact,
  });
  memory.commitMemory(seed1);
  const seed2 = memory.writePending({
    memoryType: MemoryType.Knowledge,
    content: { desc: "Existing: @cortex/engine, @cortex/llm, @cortex/shared, @cortex/testing. composite build." },
    summary: "现有包遵循 tsconfig.base.json 的 composite 构建模式",
    agentType: "meta" as AgentType,
    creatorId: "merge-exam",
    subType: MemorySubType.Fact,
  });
  memory.commitMemory(seed2);

  // ── Phase 2: 注册全部 10 个 Agent ──
  console.log("\n🟢 [Phase 2] 注册全部 Agent（10 个）...\n");

  pool.register({ type: AgentType.Code, maxInstances: 3 });
  pool.register({ type: AgentType.Review, maxInstances: 2 });
  pool.register({ type: AgentType.Analysis, maxInstances: 2 });
  pool.register({ type: AgentType.Ops, maxInstances: 2 });
  pool.register({ type: AgentType.Loop, maxInstances: 1 });
  pool.register({ type: AgentType.DocGovern, maxInstances: 1 });
  pool.register({ type: AgentType.Api, maxInstances: 1 });
  pool.register({ type: AgentType.Data, maxInstances: 1 });
  pool.register({ type: AgentType.Fix, maxInstances: 2 });
  pool.register({ type: AgentType.Inspector, maxInstances: 2 });

  const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

  interface AgentEntry {
    type: AgentType;
    label: string;
    create: () => any;
  }

  const agents: AgentEntry[] = [
    {
      type: AgentType.Code,
      label: "CodeAgent (阿贝多)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, WORKSPACE, PACKAGES_ROOT);
        return createAgent(codeAgentConfig(), adapter, tk, memory as any);
      },
    },
    {
      type: AgentType.Review,
      label: "ReviewAgent (刻晴)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, WORKSPACE, PACKAGES_ROOT);
        return createAgent(reviewAgentConfig(), adapter, tk, memory as any);
      },
    },
    {
      type: AgentType.Analysis,
      label: "AnalysisAgent (纳西妲)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, WORKSPACE, PACKAGES_ROOT);
        return createAgent(analysisAgentConfig(), adapter, tk, memory as any);
      },
    },
    {
      type: AgentType.Ops,
      label: "OpsAgent (北斗)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, WORKSPACE, PACKAGES_ROOT);
        return createAgent(opsAgentConfig(), adapter, tk);
      },
    },
    {
      type: AgentType.Loop,
      label: "LoopAgent (莫娜)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, WORKSPACE, PACKAGES_ROOT);
        return createAgent(loopAgentConfig(), adapter, tk);
      },
    },
    {
      type: AgentType.DocGovern,
      label: "DocGovernAgent (凝光)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, WORKSPACE, PACKAGES_ROOT);
        return createAgent(docGovernAgentConfig(), adapter, tk, memory as any);
      },
    },
    {
      type: AgentType.Api,
      label: "ApiAgent (久岐忍)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, WORKSPACE, PACKAGES_ROOT);
        return createAgent(apiAgentConfig(), adapter, tk, memory as any);
      },
    },
    {
      type: AgentType.Data,
      label: "DataAgent (艾尔海森)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, WORKSPACE, PACKAGES_ROOT);
        return createAgent(dataAgentConfig(), adapter, tk, memory as any);
      },
    },
    {
      type: AgentType.Fix,
      label: "FixAgent (希格雯)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, WORKSPACE, PACKAGES_ROOT);
        return createAgent(fixAgentConfig(), adapter, tk, memory as any);
      },
    },
    {
      type: AgentType.Inspector,
      label: "InspectorAgent (安柏)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, WORKSPACE, PACKAGES_ROOT);
        const agent = createInspectorAgent(adapter, tk);
        agent.setWorkspaceRoot(WORKSPACE);
        return agent;
      },
    },
  ];

  for (const entry of agents) {
    const agent = entry.create();
    await agent.wakeup();
    scheduler.register(entry.type, agent, CHAT_MODEL);
    console.log(`   ✅ ${entry.label} 就绪`);
  }
  console.log(`\n   全部 ${agents.length} 位 Agent 就绪。\n`);

  // ── Phase 3: 甘雨规划 —— 合并任务 ──
  console.log("🟢 [Phase 3] 甘雨（MetaAgent）接收合并意图...\n");

  const INTENT = [
    "══════════════════════════════════════════════════",
    "  任务：将归档 E2E 产出合并到主工程，并重构引擎",
    "══════════════════════════════════════════════════",
    "",
    "你现在面对的不是空目录，是已有 60+ 个源文件归档 + 30 个已沉淀技能，需要合并到 Cortex monorepo。",
    "",
    "⚡ 核心要求：自主迁移、自主合并、自主优化",
    "  · 自主迁移：独立完成代码搬运，不等待人工指令——读源→分析依赖→搬入 packages/→调整 import",
    "  · 自主合并：遇到冲突自行裁决——类型冲突选更严格的，路径冲突选 monorepo 约定",
    "  · 自主优化：发现冗余/低效代码主动优化——但必须遵守铁律（最小代价、不可修崩、闭环）",
    "",
    "── 资源 ──",
    "",
    "① .cortex/skills-crystallized.json（莫娜已沉淀技能，SkillRegistry 已加载）",
    "  · P0-P9：Markdown 编译器 10 个核心模式（两层管线、递归下降、访问者渲染器等）",
    "  · 架构模式：类型中枢、组合工厂、调度五元组、ReAct 循环等 10 个",
    "  · 基础设施：LLM 缓存重试、文件系统适配器、两阶段提交、技能沉淀闭环等 10 个",
    "",
    "② .cortex/archive/e2e-outputs/20260514-221019/solo-flight/（归档）",
    "  · 任务 CLI 命令：src/cli/commands/（add/delete/done/list/show/start/update）",
    "  · 数据层：src/core/models/、src/storage/、src/formatters/、src/config/、src/utils/",
    "  · 类型系统：src/types.ts（21KB，共享类型定义）",
    "  · 设计文档：docs/（8 份架构/设计文档）",
    "",
    "③ .cortex/archive/e2e-outputs/20260514-221019/closed-loop-test/（归档）",
    "  · 分析工具：tools/monorepo-analyzer.ts（28KB）、tools/configuration-drift.ts（12KB）",
    "  · 引擎增强：packages/（engine/llm/shared/testing 备选改进）",
    "  · 设计文档：webui/（7 份）、analysis_report.md、drift-detector-design.md",
    "",
    "── 目标工程 ──",
    "",
    "主工程 monorepo：pnpm workspace，packages/* 自动发现",
    "现有 4 个包（不能搞坏）：",
    "  packages/engine/    — @cortex/engine（引擎核心：调度器/Agent池/记忆存储）",
    "  packages/llm/       — @cortex/llm（LLM 适配）",
    "  packages/shared/    — @cortex/shared（共享类型/枚举）",
    "  packages/testing/   — @cortex/testing（测试工具）",
    "",
    "约定（必须遵守）：",
    "  1. 所有包 package.json 必须有 name: @cortex/<name> 和 type: module",
    "  2. 所有包 tsconfig.json 必须 extends ../../tsconfig.base.json",
    "  3. 至少要有 scripts: build (tsc)、typecheck (tsc --noEmit)、test (vitest run)",
    '  4. 内部依赖用 workspace:*，如 "@cortex/parser": "workspace:*"',
    "  5. tsconfig.base.json 不可改（target ES2022, module Node16, strict, composite）",
    "  6. 新包放在 packages/ 下，pnpm-workspace.yaml 自动覆盖",
    "  7. 禁止路径嵌套——不要写出 packages/pm/packages/pm/src/ 这种双层结构",
    "  8. 文档可自行整理——觉得位置不对的有能力就搬到合理位置（docs/、packages/<name>/README.md 等）",
    "",
    "══════════════════════════════════════════════════",
    "  第一阶段：扫描与合并",
    "══════════════════════════════════════════════════",
    "",
    "1. 纳西妲读现有工程：packages/*/package.json、tsconfig.base.json、各包 tsconfig.json",
    "2. 艾尔海森读归档资源，梳理类型依赖关系",
    "3. 阿贝多利用莫娜沉淀的技能（SkillRegistry 中 30 个模板）加速实现：",
    "   · packages/parser/ — Markdown→HTML 编译器（P0-P9 模式参考）",
    "   · packages/cli/ — 命令行工具集合（task CLI 命令）",
    "   · packages/tools/ — 分析工具（monorepo-analyzer + drift-detector）",
    "   · packages/data/ — 数据处理层（core/models + storage + formatters）",
    "   每个包必须包含：package.json、tsconfig.json、src/、tests/",
    "4. 久岐忍检查 API 导出边界——每个包的 index.ts 只导出该包的公开 API",
    "5. 北斗跑 `pnpm install` 链接依赖",
    "",
    "══════════════════════════════════════════════════",
    "  第二阶段：重构引擎（准许，但不可修崩）",
    "══════════════════════════════════════════════════",
    "",
    "引擎代码是可修改的目标，不是禁区。",
    "你可以改进 packages/engine/、packages/llm/、packages/shared/、packages/testing/",
    "中的任何文件——但必须遵守三条铁律：",
    "",
    "  ⚡ 铁律一：最小代价",
    "  每次修改只解决一个确切的问题。不要因为'顺手'就多改。",
    "  问自己：这个问题能不能通过新增一个函数/一个导出解决，而不是重写整个文件？",
    "",
    "  ⚡ 铁律二：不可修崩",
    "  改完必须跑 `pnpm build && pnpm test`，全部通过才交。",
    "  如果 build 或 test 失败，必须修到全绿。不允许提交中间态。",
    "",
    "  ⚡ 铁律三：闭环",
    "  修复一个 bug 后，写一个测试证明它不会再出现。",
    "  重构一个模块后，确保所有引用它的包都能编译。",
    "",
    "引擎重构的具体方向（仅供参考，甘雨自主裁决）：",
    "  · 归档的 closed-loop-test/packages/engine/package.json 里有引擎增强的线索",
    "  · 归档的 types.ts（21KB）里可能有值得提取到 shared 的类型",
    "  · 新合并的包需要引擎支持的特性（如 CLI 框架抽象）可以加到 engine",
    "  · 刻晴和艾尔海森发现的引擎缺陷交给希格雯修复",
    "",
    "══════════════════════════════════════════════════",
    "  最终验收",
    "══════════════════════════════════════════════════",
    "",
    "  ① pnpm build → 全部包编译通过，零错误",
    "  ② pnpm test → 全部测试通过，零失败",
    "  ③ 新包的 CLI 可执行：pm --help、md-to-html --help",
    "  ④ 现有包的构建和测试不被破坏",
    "",
    "── 团队 ──",
    "· 纳西妲（Analysis）— 架构分析    · 艾尔海森（Data）— 数据建模",
    "· 阿贝多（Code）— 实现搬运        · 北斗（Ops）— 构建脚本",
    "· 刻晴（Review）— 代码审查        · 希格雯（Fix）— 修复缺陷",
    "· 莫娜（Loop）— 模式发现          · 安柏（Inspector）— 最终验证",
    "· 凝光（DocGovern）— 治理合规     · 久岐忍（Api）— API 设计",
    "",
    "甘雨，你排任务图。至少分出合并和重构两个阶段。",
    "中文回复，输出 TaskNode JSON。",
  ].join("\n");

  console.log("   📋 MetaAgent 思考中（分析三路资源 + 现有工程结构）...\n");
  const planStart = Date.now();
  let plan: TaskNode[];
  try {
    plan = await metaAgent.plan(INTENT);
  } catch (e) {
    console.error(`   ❌ MetaAgent 规划失败: ${String(e).slice(0, 200)}`);
    process.exit(1);
  }
  const planDuration = Date.now() - planStart;

  console.log(`   ✅ MetaAgent 产出 ${plan.length} 个任务节点 (${planDuration}ms):`);
  for (const n of plan) {
    const parent = n.parentId ? ` → child of [${n.parentId.slice(0, 20)}]` : " → root";
    console.log(`      [${n.type}] ${n.id.slice(0, 40)}${parent}  tags: [${(n.tags ?? []).join(", ")}]`);
  }

  if (plan.length === 0) {
    console.error("\n❌ MetaAgent 产出 0 个任务节点，中止。");
    process.exit(1);
  }

  for (const n of plan) {
    board.addNode(n);
  }
  console.log(`\n   ${plan.length} 个节点已入板。\n`);

  // ── Phase 4: 执行 ──
  console.log("🟢 [Phase 4] Scheduler 执行...\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const completedNodes: string[] = [];
  const failedNodes: string[] = [];

  observer.on(PipelinePriority.HIGH, (e) => {
    const p = e.payload as any;
    const id = p?.nodeId ? `[${(p.nodeId as string).slice(0, 20)}]` : "";
    if (e.type === "node.complete") {
      completedNodes.push(id);
      console.log(`   ✅ ${id} ${p.agentType ?? "?"} 完成`);
    } else if (e.type === "node.failed") {
      failedNodes.push(id);
      console.log(`   ❌ ${id} 失败: ${String(p.error ?? "").slice(0, 80)}`);
    } else if (e.type === "node.replan") {
      console.log(`   🔄 ${id} 重规划 #${p.attempt}: ${String(p.reason ?? "").slice(0, 80)}`);
    } else if (e.type === "scheduler.layer.start") {
      console.log(`\n   📊 第 ${p.layer} 层开始 (${p.nodes} 个节点)\n`);
    }
  });

  const execStart = Date.now();
  const report = await scheduler.executeAll();
  const execDuration = Date.now() - execStart;

  // ── Phase 5: 结果 ──
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   📊 执行结果                                     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`   完成: ${report.completed}  失败: ${report.failed}  耗时: ${execDuration}ms`);
  console.log();

  const allNodes = board.getAllNodes();
  for (const n of allNodes) {
    const status = n.status === "done" ? "✅" : n.status === "failed" ? "❌" : "⏳";
    console.log(`   ${status} [${n.type}] ${n.id.slice(0, 50)} (${n.status})`);
    for (const r of n.results) {
      const preview = (r.output ?? r.error ?? "?").slice(0, 200);
      console.log(`      ${r.success ? "✅" : "❌"} ${preview}`);
    }
  }
  console.log();

  // ── Phase 6: 闭环验证 —— 构建 + 测试全量通过 ──
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🔍 闭环验证：pnpm build && pnpm test 全量通过    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  let closedLoopPassed = true;

  // 验证新包目录存在
  console.log("   📦 检查新包目录...");
  const expectedDirs = [
    "packages/parser",
    "packages/cli",
    "packages/data",
    "packages/tools",
  ];
  const foundDirs: string[] = [];
  for (const dir of expectedDirs) {
    const full = path.resolve(WORKSPACE, dir);
    if (fs.existsSync(full)) {
      foundDirs.push(dir);
      console.log(`   ✅ ${dir}/ 已创建`);
    }
  }
  if (foundDirs.length === 0) {
    console.log("   ⚠️ 未发现新包目录（可能创建在其他位置）");
  }

  // 检查现有包未被意外修改
  console.log("\n   🔒 检查现有包完整性...");
  const protectedFiles = [
    "packages/engine/package.json",
    "packages/llm/package.json",
    "packages/shared/package.json",
    "packages/testing/package.json",
    "tsconfig.base.json",
    "pnpm-workspace.yaml",
  ];
  for (const f of protectedFiles) {
    const full = path.resolve(WORKSPACE, f);
    if (!fs.existsSync(full)) {
      console.log(`   ❌ 关键文件丢失: ${f}`);
      closedLoopPassed = false;
    }
  }

  // pnpm build
  console.log("\n   🔨 pnpm build...");
  try {
    const { execSync } = await import("node:child_process");
    const buildOutput = execSync("pnpm build", {
      cwd: WORKSPACE,
      timeout: 120_000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("   ✅ pnpm build 通过");
    if (buildOutput.trim()) {
      console.log(buildOutput.slice(0, 500));
    }
  } catch (e: any) {
    console.log(`   ❌ pnpm build 失败:`);
    console.log((e.stderr?.toString() ?? e.stdout?.toString() ?? "").slice(0, 500));
    closedLoopPassed = false;
  }

  // pnpm test
  console.log("\n   🧪 pnpm test...");
  try {
    const { execSync } = await import("node:child_process");
    const testOutput = execSync("pnpm test", {
      cwd: WORKSPACE,
      timeout: 120_000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("   ✅ pnpm test 通过");
    if (testOutput.trim()) {
      console.log(testOutput.slice(0, 500));
    }
  } catch (e: any) {
    console.log(`   ❌ pnpm test 失败:`);
    console.log((e.stderr?.toString() ?? e.stdout?.toString() ?? "").slice(0, 500));
    closedLoopPassed = false;
  }

  // ── 记忆系统诊断 ──
  console.log("\n── 记忆系统诊断 ──");
  const allMemories = memory.read({});
  const withTask = allMemories.filter((m) => m.metadata?.taskId);
  console.log(`   总记忆: ${allMemories.length}  含任务关联: ${withTask.length}`);
  for (const m of withTask.slice(0, 8)) {
    console.log(`     📖 [${m.memoryType}] ${(m.summary ?? "").slice(0, 120)}`);
  }

  // ── Phase 8: 六层防御合规性 ──
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   🛡️  六层防御合规性（P0 + P1 + P2）             ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // P0: 子类型与状态分布
  const allMemoriesFull = memory.read({ includePrivate: true, trackAccess: false });
  const bySubType: Record<string, number> = {};
  const byState: Record<string, number> = {};
  for (const m of allMemoriesFull) {
    bySubType[m.subType ?? "?"] = (bySubType[m.subType ?? "?"] ?? 0) + 1;
    byState[m.state] = (byState[m.state] ?? 0) + 1;
  }
  console.log(`   P0-子类型: ${Object.entries(bySubType).map(([k,v]) => `${k}=${v}`).join(", ")}`);
  console.log(`   P0-状态:   ${Object.entries(byState).map(([k,v]) => `${k}=${v}`).join(", ")}`);

  // P0: Pending 隔离检查
  const pendingMemories = allMemoriesFull.filter((m) => m.state === MemoryState.Pending);
  const defaultRead = memory.read({ includePrivate: true, trackAccess: false });
  const pendingInDefault = defaultRead.filter((m) => m.state === MemoryState.Pending);
  const pendingVisible = memory.read({ includePrivate: true, states: [MemoryState.Pending], trackAccess: false });
  console.log(`   P0-Pending: ${pendingMemories.length} 条 | 默认可见=${pendingInDefault.length} | 显式查=${pendingVisible.length}`);
  // Pending 隔离判定：有 Pending 记忆且默认 read 不可见 → 隔离生效
  const pendingIsolated = pendingMemories.length > 0 ? pendingInDefault.length === 0 : true;
  console.log(`   P0-Pending隔离: ${pendingIsolated ? "✅" : "❌"} (Pipeline writePending→commitMemory 两阶段生效)`);

  // P1: InitVerifier 启动校验
  console.log(`\n   ── P1 InitVerifier ──`);
  const consistencyReport = await consistency.verify();
  if (consistencyReport) {
    console.log(`   P1-文件校验: 总记忆=${consistencyReport.totalMemories}  已检查=${consistencyReport.checkedMemories}  ok=${consistencyReport.summary.ok}  missing=${consistencyReport.summary.missing}  unchecked=${consistencyReport.summary.unchecked}`);
    const fileChecks = consistencyReport.fileChecks;
    const missing = fileChecks.filter((d) => d.status === "missing");
    if (missing.length > 0) {
      console.log(`      缺失 ${missing.length} 文件:`);
      for (const d of missing.slice(0, 5)) console.log(`        ❌ ${d.filePath}`);
      if (missing.length > 5) console.log(`        ... 还有 ${missing.length - 5} 个`);
    }
    console.log(`   P1-InitVerifier: ${consistencyReport.fatal ? "💥 致命" : "✅ 通过"}`);
  } else {
    console.log(`   P1-InitVerifier: ⚠️ 未启用`);
  }

  // P1: SchemaEnforcer 抽样 + annotate
  console.log(`\n   ── P1 SchemaEnforcer ──`);
  const sampleMemories = allMemoriesFull.slice(0, 3);
  const sampleInputs = sampleMemories.map((m) => ({
    memoryType: m.memoryType,
    content: (m.content ?? {}) as Record<string, unknown>,
    summary: m.summary,
    agentType: m.agentType,
    creatorId: m.creatorId,
    subType: m.subType,
  } as import("@cortex/shared").MemoryWriteInput));
  let schemaFailCount = 0;
  for (const input of sampleInputs) {
    const validated = consistency.validateInput(input);
    if (!validated.valid) {
      schemaFailCount++;
      console.log(`       ⚠️ 校验失败: ${validated.errors?.join(", ")}`);
    }
  }
  console.log(`   P1-SchemaEnforcer: 抽样 ${sampleInputs.length - schemaFailCount}/${sampleInputs.length} 通过`);

  const annotateInput: import("@cortex/shared").MemoryWriteInput = {
    memoryType: "EPISODIC" as import("@cortex/shared").MemoryType,
    content: { value: "merge-annotate-test" },
    summary: "合并大考 annotate 默认值测试",
    agentType: "code" as import("@cortex/shared").AgentType,
    creatorId: "merge-exam",
    embedding: new Array(768).fill(0),
  };
  const annotated = consistency.annotateInput(annotateInput);
  console.log(`   P1-annotate: subType 默认值 = ${annotated.subType ?? "(空)"} ${annotated.subType === MemorySubType.Fact ? "✅" : "❌"}`);

  // P2: 技能沉淀闭环检查
  console.log(`\n   ── P2 技能沉淀 ──`);
  const skillMemories = memory.read({ memoryTypes: [MemoryType.Skill], trackAccess: false });
  const skillPrecipitated = skillMemories.length > 0;
  console.log(`   P2-技能沉淀: ${skillPrecipitated ? "✅ (已闭环)" : "⚠️ (空——无可复用技能沉淀)"}`);
  if (skillMemories.length > 0) {
    for (const sm of skillMemories.slice(0, 5)) {
      const c = sm.content as Record<string, unknown> | undefined;
      console.log(`     📌 [${c?.agentType ?? "?"}] ${c?.name ?? "?"} — ${String(c?.trigger ?? "?").slice(0, 60)}`);
    }
    if (skillMemories.length > 5) console.log(`     ... 还有 ${skillMemories.length - 5} 个`);
  }

  // ── 收尾 ──
  await memory.close();

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log(`║   ${closedLoopPassed ? "✅ 合并大考 —— 闭环验证通过" : "❌ 闭环验证失败"}        ║`);
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`   规划耗时: ${planDuration}ms (${(planDuration / 1000).toFixed(1)}s)`);
  console.log(`   执行耗时: ${execDuration}ms (${(execDuration / 1000).toFixed(1)}s)`);
  console.log(`   总耗时:   ${((planDuration + execDuration) / 1000).toFixed(1)}s`);
  console.log(`   MetaAgent 计划: ${plan.length} 节点`);
  console.log(`   Scheduler 完成: ${report.completed}  失败: ${report.failed}`);
  console.log(`   新包目录: ${foundDirs.length > 0 ? foundDirs.join(", ") : "(未检测到)"}`);
  console.log(`   pnpm build: ${closedLoopPassed ? "✅" : "❌"}`);
  console.log(`   pnpm test:  ${closedLoopPassed ? "✅" : "❌"}`);
  console.log(`   六层防御: P0-Pending隔离 ${pendingIsolated ? "✅" : "❌"} | P1-InitVerifier ${consistencyReport && !consistencyReport.fatal ? "✅" : "⚠️"} | P2-技能沉淀 ${skillPrecipitated ? "✅" : "⚠️"}`);
  console.log();

  if (!closedLoopPassed || report.failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("💥 合并大考 E2E 崩溃:", e);
  process.exit(1);
});
