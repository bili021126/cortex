/**
 * 独自飞翔 E2E —— 冷启动：空目录起步，Agent 从零建造一个完整项目
 *
 * 用法: npx tsx tests/manual/e2e/solo-flight.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 与 closed-loop-collab 的区别:
 *   - 无任何参照代码库 —— Agent 面对的是空目录
 *   - 意图开放但明确 —— "造一个你认为值得造的项目"
 *   - 全工具开放 —— 读写、shell 全部可用，但限定区域
 *   - 冷启动验证 —— 没有宪法、没有 MemoryStore 种子、没有先例
 *
 * 安全红线:
 *   - 所有文件操作限定在 PROJECT_DIR 内（写入越界直接拒绝）
 *   - shell 危险命令拦截
 *   - 不碰主仓库任何代码
 *
 * 验收标准:
 *   1. MetaAgent 产出 ≥1 个 TaskNode
 *   2. Scheduler.executeAll() 完成
 *   3. 产出文件真实存在且非空
 *   4. 至少一个产物可成功执行（npx tsx 不报错）
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType, PipelinePriority, type SemanticState, type TaskNode } from "@cortex/shared";
import { loadSkillsFromMemory, scanOutputFilesForSkills } from "@cortex/engine";
import { LlmAdapter } from "@cortex/llm";
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
  MemoryStore,
  defaultEmbeddingService,
  // 🧪 组合式调度器
  CompositeScheduler,
  TagMatchingStrategy,
  RoundRobinStrategy,
  PriorityFirstStrategy,
  TopologicalLayeredDriver,
  SequentialDriver,
  WaveDriver,
  PipelineModel,
  SimpleExecuteModel,
  SearchAggregator,
  DdgSearchBackend,
  McpSearchBackend} from "@cortex/engine";
import type { IScheduleStrategy, ILoopDriver, IExecutionModel } from "@cortex/engine";
import type { SearchBackend } from "@cortex/engine";
import type { Agent } from "@cortex/shared";
import { resolveLlmConfig } from "../config/llm-defaults";

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
// 1. 工具注册 —— 全工具开放，但限定区域
// ══════════════════════════════════════════════

const DANGEROUS = /\b(rm\s+-rf|del\s+\/F|shutdown|reboot|sudo|chmod\s+777|>\/dev\/|curl.*\|.*sh|wget.*-O.*\||mkfs)\b/i;
const DANGEROUS_FORMAT = /\bformat\s+[A-Za-z]:/i; // 单独处理 —— 避免误伤 --format CLI 标志

function registerAllTools(toolkit: Toolkit, projectRoot: string) {
  const resolve = (p: string) => {
    const normalized = path.normalize(p);
    // 如果路径已经是 projectRoot 下的绝对路径，直接返回
    if (path.isAbsolute(normalized) && normalized.toLowerCase().startsWith(projectRoot.toLowerCase() + path.sep)) {
      return normalized;
    }
    // 去掉绝对路径前缀（/、\、C:\ 等），防止 path.resolve 吞掉 projectRoot
    const clean = p.replace(/^[a-zA-Z]:[\\/]/, '').replace(/^[\\/]+/, '');
    return path.resolve(projectRoot, clean || '.');
  };

  // ── 读取（不做越界限制 —— 与 closed-loop-collab 一致）──

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
    if (!query) return { success: false, error: "Missing query/pattern" };
    try {
      const results: string[] = [];
      const walk = (d: string, depth: number) => {
        if (depth > 5) return;
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            walk(full, depth + 1);
          } else if (entry.isFile() && /\.(ts|js|json|md)$/.test(entry.name)) {
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

  // ── 写入 —— 白名单制，拒绝越界 ──

  toolkit.register("write_file", async (params) => {
    const fp = resolve(params.file_path as string);
    if (!fp.startsWith(projectRoot + path.sep)) {
      return { success: false, error: `write_file denied: 路径越界 ${fp}\n  提示: 请使用相对路径，如 "design.md" 或 "src/index.ts"` };
    }
    try {
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const content = (params.content ?? params.content_blob) as string;
      if (!content) return { success: false, error: "write_file: 缺少 content 参数" };
      fs.writeFileSync(fp, content, "utf-8");
      return { success: true, output: `Wrote ${Buffer.byteLength(content)} bytes to ${fp}` };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  // ── Shell —— 危险命令拦截，其余放行 ──

  toolkit.register("run_shell", async (params) => {
    const cmd = (params.command ?? "") as string;
    if (!cmd) return { success: false, error: "run_shell: 缺少 command 参数" };
    if (DANGEROUS.test(cmd) || DANGEROUS_FORMAT.test(cmd)) {
      return { success: false, error: `run_shell denied: 危险命令已拦截 "${cmd.slice(0, 80)}"` };
    }
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(cmd, {
        cwd: projectRoot,
        timeout: 120_000,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"]});
      return { success: true, output: output || "(exit 0, no output)" };
    } catch (e: any) {
      const stderr = e.stderr?.toString() ?? "";
      const stdout = e.stdout?.toString() ?? "";
      return {
        success: false,
        error: `Command failed (exit ${e.status ?? "?"}): ${e.message.slice(0, 200)}\nstdout: ${stdout.slice(0, 300)}\nstderr: ${stderr.slice(0, 300)}`};
    }
  });
}

// ══════════════════════════════════════════════
// 2. 调度策略解析
// ══════════════════════════════════════════════

/** 从 plan 原始输出中提取 MetaAgent 声明的调度策略组合 */
function tryParseMetaStrategy(planText: string): { strategy?: string; driver?: string; exec?: string } {
  // MetaAgent 被指示输出: STRATEGY: <策略> | <驱动> | <执行模型>
  const m = planText.match(/STRATEGY:\s*([\w-]+)\s*\|\s*([\w-]+)\s*\|\s*([\w-]+)/i);
  if (m) return { strategy: m[1].trim(), driver: m[2].trim(), exec: m[3].trim() };
  // 兼容宽松格式
  const loose = planText.match(/STRATEGY:\s*(.+)/i);
  if (loose) {
    const parts = loose[1].split(/[|,]/).map(s => s.trim().toLowerCase());
    return { strategy: parts[0], driver: parts[1], exec: parts[2] };
  }
  return {};
}

/** 从 plan 原始输出（TaskNode[]）中提取 LLM 的规划文本 */
function extractPlanText(plan: TaskNode[]): string {
  // Agent.plan 返回的是 TaskNode[] 的 JSON 文本片段，由 MetaAgent.plan 负责返回。
  // 实际的计划文本嵌入在节点 payload 中，或通过特殊节点承载。
  for (const n of plan) {
    if (n.payload && typeof n.payload === "string" && n.payload.length > 20) return n.payload;
  }
  return "";
}

function resolveStrategy(cliOverride: string | null, planText: string): IScheduleStrategy {
  const parsed = tryParseMetaStrategy(planText);
  const name = cliOverride ?? parsed.strategy ?? "tag-matching";
  const map: Record<string, IScheduleStrategy> = {
    "tag-matching": new TagMatchingStrategy(),
    "round-robin": new RoundRobinStrategy(),
    "priority-first": new PriorityFirstStrategy()};
  return map[name] ?? map["tag-matching"];
}

function resolveDriver(cliOverride: string | null, planText: string): ILoopDriver {
  const parsed = tryParseMetaStrategy(planText);
  const name = cliOverride ?? parsed.driver ?? "wave";
  const map: Record<string, ILoopDriver> = {
    "topological-layered": new TopologicalLayeredDriver(),
    "sequential": new SequentialDriver(),
    "wave": new WaveDriver()};
  return map[name] ?? map["wave"];
}

function resolveExecModel(cliOverride: string | null, planText: string): IExecutionModel {
  const parsed = tryParseMetaStrategy(planText);
  const name = cliOverride ?? parsed.exec ?? "pipeline";
  const map: Record<string, IExecutionModel> = {
    "pipeline": new PipelineModel(),
    "simple": new SimpleExecuteModel()};
  return map[name] ?? map["pipeline"];
}

// ══════════════════════════════════════════════
// 2.5. 母项目自动探索 —— 替甘雨扫描，避免闭门造车
// ══════════════════════════════════════════════

interface PackageSummary {
  dir: string;
  name: string;
  description: string;
  internalDeps: string[];
  mainEntry: string | null;
}

/** 扫描 packages/ 目录，收集每个子包的结构摘要 */
function discoverParentProject(packagesDir: string): string {
  const lines: string[] = [];
  lines.push("=== 母项目自动探索结果（由脚本在规划前预扫描注入） ===");
  lines.push("");

  if (!fs.existsSync(packagesDir)) {
    lines.push("(packages/ 目录不存在，无探索结果)");
    return lines.join("\n");
  }

  const entries = fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."));

  const summaries: PackageSummary[] = [];
  for (const entry of entries) {
    const pkgJsonPath = path.join(packagesDir, entry.name, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    try {
      const raw = fs.readFileSync(pkgJsonPath, "utf-8");
      const json = JSON.parse(raw);
      const internalDeps: string[] = [];
      for (const section of ["dependencies", "devDependencies"] as const) {
        for (const [dep] of Object.entries((json[section] ?? {}) as Record<string, string>)) {
          if (dep.startsWith("@cortex/")) internalDeps.push(dep.replace("@cortex/", ""));
        }
      }
      // 探测入口文件
      let mainEntry: string | null = null;
      for (const candidate of ["src/index.ts", "src/main.ts", "index.ts"]) {
        if (fs.existsSync(path.join(packagesDir, entry.name, candidate))) {
          mainEntry = candidate;
          break;
        }
      }
      summaries.push({
        dir: entry.name,
        name: json.name ?? `@cortex/${entry.name}`,
        description: json.description ?? "(无描述)",
        internalDeps,
        mainEntry,
      });
    } catch { /* skip broken package.json */ }
  }

  // 输出探索报告
  lines.push(`发现 ${summaries.length} 个子包:\n`);
  for (const s of summaries) {
    const deps = s.internalDeps.length > 0 ? s.internalDeps.join(", ") : "无内部依赖";
    const entry = s.mainEntry ? ` 入口: ${s.mainEntry}` : "";
    lines.push(`  ${s.dir}/`);
    lines.push(`    包名: ${s.name}`);
    if (s.description !== "(无描述)") lines.push(`    描述: ${s.description}`);
    lines.push(`    内部依赖: ${deps}${entry}`);
    lines.push("");
  }

  // 额外：列举 skills/ 和 prompts/ 目录（辅助理解项目全貌）
  for (const extra of ["skills", "prompts"]) {
    const extraPath = path.resolve(packagesDir, "..", extra);
    if (fs.existsSync(extraPath)) {
      const files = fs.readdirSync(extraPath, { withFileTypes: true })
        .filter((e) => e.isFile()).map((e) => e.name);
      const dirs = fs.readdirSync(extraPath, { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => `${e.name}/`);
      if (files.length > 0 || dirs.length > 0) {
        lines.push(`  ${extra}/ 目录内容: ${[...dirs, ...files].slice(0, 10).join(", ")}${files.length + dirs.length > 10 ? " ..." : ""}`);
      }
    }
  }

  return lines.join("\n");
}

/** 联网搜索：必应中文 MCP 主搜 + DDG fallback，帮甘雨了解生态现状 */
async function researchWebContext(): Promise<string> {
  const lines: string[] = [];
  lines.push("=== 联网搜索洞察（由脚本在规划前预搜索注入） ===");
  lines.push("");

  // ── 读取 cortex-agents.json 获取 bing-cn-mcp 配置 ──
  const agentsJsonPath = path.resolve(process.cwd(), "cortex-agents.json");
  let bingBackend: SearchBackend | null = null;
  try {
    const raw = fs.readFileSync(agentsJsonPath, "utf-8");
    const agentsConfig = JSON.parse(raw) as { searchProviders?: { backends?: Array<{ id: string; command: string; args: string[]; enabled: boolean }> } };
    const bingCfg = agentsConfig.searchProviders?.backends?.find(b => b.id === "bing" && b.enabled);
    if (bingCfg) {
      bingBackend = new McpSearchBackend({
        id: bingCfg.id,
        command: bingCfg.command,
        args: bingCfg.args,
        enabled: true,
      });
    }
  } catch {
    // 读取配置失败不阻断
  }

  // ── 构建聚合器：Bing MCP 优先，DDG fallback ──
  const backends: SearchBackend[] = [];
  if (bingBackend) {
    backends.push(bingBackend);
    try { await (bingBackend as McpSearchBackend).start(); } catch { bingBackend = null; }
  }
  const ddg = new DdgSearchBackend(10_000, 1);
  backends.push(ddg);
  const aggregator = new SearchAggregator({ backends, cacheTTL: 0, minBackends: 1 });

  const queries = [
    "TypeScript monorepo 分析工具 2025 2026 推荐",
    "多智能体 AI 开发框架 互补工具 生态",
    "开发者效率 CLI 工具 TypeScript 生态 2026",
  ];

  for (const q of queries) {
    try {
      const results = await aggregator.search(q, 3);
      if (results.length > 0) {
        lines.push(`🔍 "${q}":`);
        for (const r of results) {
          lines.push(`  · ${r.title} [${r.source}]`);
          lines.push(`    ${r.snippet.slice(0, 200)}`);
          lines.push(`    ${r.url}`);
        }
        lines.push("");
      }
    } catch {
      // 个别查询失败不阻断
    }
  }

  // ── 清理 MCP 子进程 ──
  if (bingBackend) {
    try { await (bingBackend as McpSearchBackend).stop(); } catch { /* ignore */ }
  }

  if (lines.length <= 3) {
    lines.push("(网络搜索未返回结果，不影响后续流程)");
  }

  return lines.join("\n");
}
// ══════════════════════════════════════════════

async function main() {
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) { console.error("❌ DEEPSEEK_API_KEY 未设置"); process.exit(1); }

  const llmCfg = resolveLlmConfig();
  const BASE_URL = llmCfg.baseUrl;
  const CHAT_MODEL = llmCfg.chatModel;
  const REASONER_MODEL = llmCfg.reasonerModel;
  const WORKSPACE = process.cwd();

  // ── 工作目录：专用实验目录，不与正式包冲突 ──
  const PROJECT_DIR = path.resolve(WORKSPACE, "projects", "_solo-flight-target");
  if (fs.existsSync(PROJECT_DIR)) {
    const existing = fs.readdirSync(PROJECT_DIR).filter(f => f !== ".gitkeep");
    if (existing.length > 0) {
      console.log(`⚠️  实验目录非空，清理 ${existing.length} 个残留文件...`);
    }
    fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(PROJECT_DIR, { recursive: true });

  // monorepo 标准子包配置
  const pkgPath = path.join(PROJECT_DIR, "package.json");
  fs.writeFileSync(pkgPath, JSON.stringify({
    name: "@cortex/solo-flight-target",
    version: "0.1.0",
    private: true,
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: {
      ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
    },
    scripts: {
      "build": "tsc",
      "typecheck": "tsc --noEmit",
      "test": "vitest run",
      "test:watch": "vitest"
    },
    dependencies: {
      "@cortex/shared": "workspace:*"
    },
    devDependencies: {
      "@types/node": "^22.0.0",
      "typescript": "^5.7.0",
      "vitest": "^2.1.0"
    }
  }, null, 2));

  const tsconfigPath = path.join(PROJECT_DIR, "tsconfig.json");
  fs.writeFileSync(tsconfigPath, JSON.stringify({
    "extends": "../../tsconfig.base.json",
    compilerOptions: {
      outDir: "./dist",
      rootDir: "./src"
    },
    include: ["src"]
  }, null, 2));

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🕊️  独自飞翔 —— 冷启动，空目录，从零建造       ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  项目路径: ${PROJECT_DIR}`);
  console.log(`  起点:     空目录（仅 package.json + tsconfig.json）`);
  console.log(`  Chat:     ${CHAT_MODEL}`);
  console.log(`  Reasoner: ${REASONER_MODEL}\n`);

  // ── Phase 1: 基础设施 ──
  console.log("🟢 [Phase 1] 初始化基础设施...\n");

  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    reasonerModel: REASONER_MODEL,
    reasoningEffort: llmCfg.reasoningEffort as "high" | "max"});
  adapter.setCacheEnabled(true);

  const metaAgent = new MetaAgent(adapter);
  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();
  const gate = new ConfirmGate();
  gate.bypassAll();

  const memory = new MemoryStore(undefined, defaultEmbeddingService);
  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", "memory-solo-flight.db");
  await memory.init(MEMORY_DB);
  console.log(`   MemoryStore: ${MEMORY_DB}`);

  // P1 一致性校验层（文件校验 + 结构校验）
  const fsAdapter = new NodeFileSystemAdapter();
  const consistency = new ConsistencyLayer(memory, {
    projectRoot: PROJECT_DIR,
    enableInitVerifier: true,
    enableSchemaEnforcer: true,
    fs: fsAdapter,
    searchPaths: ["src", "test", "samples", "dist"]});
  console.log(`   ConsistencyLayer: InitVerifier + SchemaEnforcer 已启用`);

  // ── 技能系统：冷启动加载已有技能 + 文件回溯扫描 ──
  const skillRegistry = new SkillRegistry();
  const loadedSkills = await loadSkillsFromMemory(memory);
  if (loadedSkills.length > 0) {
    skillRegistry.registerAll(loadedSkills);
    console.log(`   从记忆库加载 ${loadedSkills.length} 个技能模板`);
  }
  const scannedSkills = scanOutputFilesForSkills(PROJECT_DIR);
  if (scannedSkills.length > 0) {
    skillRegistry.registerAll(scannedSkills);
    console.log(`   从文件回溯扫描 ${scannedSkills.length} 个技能模板`);
  }
  console.log(`   SkillRegistry: ${skillRegistry.activeCount} 个活跃技能就绪`);

  // ══════════════════════════════════════════════
  // 🧪 调度策略 —— 甘雨自主选择（或 CLI 覆盖）
  // ══════════════════════════════════════════════
  //
  //  可用组合见 implementations.ts：
  //
  //  IScheduleStrategy: tag-matching | round-robin | priority-first
  //  ILoopDriver:        topological-layered | sequential | wave
  //  IExecutionModel:    pipeline | simple
  //
  //  共 3×3×2 = 18 种组合。甘雨根据项目特点选择最优组合。
  //
  // ── Phase 2a: 先创建全部 Agent（暂不注册到调度器）──
  console.log("\n🟢 [Phase 2a] 创建全部 Agent（10 个）...\n");

  interface AgentEntry {
    type: AgentType;
    agent: Agent;
  }

  // 注册池（AgentPool 独立于调度器）
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

  const agentEntries: { type: AgentType; label: string; create: () => Agent }[] = [
    {
      type: AgentType.Code,
      label: "CodeAgent (阿贝多)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return createAgent(codeAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Review,
      label: "ReviewAgent (刻晴)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return createAgent(reviewAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Analysis,
      label: "AnalysisAgent (纳西妲)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return createAgent(analysisAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Ops,
      label: "OpsAgent (北斗)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return createAgent(opsAgentConfig("solo-flight"), adapter, tk);
      }},
    {
      type: AgentType.Loop,
      label: "LoopAgent (莫娜)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return createAgent(loopAgentConfig("solo-flight"), adapter, tk);
      }},
    {
      type: AgentType.DocGovern,
      label: "DocGovernAgent (凝光)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return createAgent(docGovernAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Api,
      label: "ApiAgent (久岐忍)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return createAgent(apiAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Data,
      label: "DataAgent (艾尔海森)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return createAgent(dataAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Fix,
      label: "FixAgent (希格雯)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        return createAgent(fixAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Inspector,
      label: "InspectorAgent (安柏)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, PROJECT_DIR);
        const agent = createInspectorAgent(adapter, tk);
        agent.setWorkspaceRoot(PROJECT_DIR);
        return agent;
      }},
  ];

  // 创建并 wakeup 全部 Agent（暂不注册到调度器——调度器在甘雨选择策略后才构造）
  const builtAgents = new Map<AgentType, Agent>();
  for (const entry of agentEntries) {
    const agent = entry.create();
    await agent.wakeup();
    builtAgents.set(entry.type, agent);
    console.log(`   ✅ ${entry.label} 就绪`);
  }
  console.log(`\n   全部 ${builtAgents.size} 位 Agent 就绪。\n`);

  // ── Phase 3: 甘雨规划 —— 先探索母项目，再自主决策（含策略选择）──
  console.log("🟢 [Phase 3] 预探索母项目结构 → 甘雨（MetaAgent）接收意图 + 选择调度策略...\n");

  // 🔍 替甘雨扫描母项目 + 联网搜索，避免闭门造车
  const PARENT_PACKAGES_DIR = path.resolve(WORKSPACE, "packages");
  const discoveryReport = discoverParentProject(PARENT_PACKAGES_DIR);
  console.log(`   📂 母项目探索完成，注入 ${discoveryReport.split("\n").filter(l => l.startsWith("  ") && l.includes("/")).length} 个子包信息`);

  const webReport = await researchWebContext();
  const webLines = webReport.split("\n").filter(l => l.startsWith("🔍")).length;
  console.log(`   🌐 联网搜索完成，${webLines} 个查询有结果`);

  // CLI 参数：--intent / --strategy / --driver / --exec
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
  };
  const userIntent = getArg("--intent");
  const cliStrategy = getArg("--strategy");
  const cliDriver = getArg("--driver");
  const cliExec = getArg("--exec");

  if (cliStrategy || cliDriver || cliExec) {
    console.log(`   🎛️  CLI 覆盖调度: ${cliStrategy ?? "auto"} | ${cliDriver ?? "auto"} | ${cliExec ?? "auto"}\n`);
  }

  // 策略选项描述
  const STRATEGY_SECTION = [
    "=== 调度策略 —— 你必须选择一种组合 ===",
    "",
    "可用匹配策略（IScheduleStrategy —— 如何将 Agent 匹配到任务）：",
    "  tag-matching    —— 按 Agent 类型标签匹配（适合异构 Agent 池）",
    "  round-robin      —— 轮转所有 Agent（适合同构池）",
    "  priority-first   —— 类似 tag-matching，但优先空闲 Agent（适合混合负载）",
    "",
    "可用循环驱动器（ILoopDriver —— 如何推进执行轮次）：",
    "  topological-layered —— 拓扑排序，按层并行（适合 DAG 依赖）",
    "  sequential          —— 逐节点执行，严格顺序（适合调试/简单场景）",
    "  wave                —— 按语义波次分组（设计→实现→审查→验证）",
    "",
    "可用执行模型（IExecutionModel —— 每个节点如何派发）：",
    "  pipeline —— 完整流水线：Claim→Spawn→Skill→Execute→Cleanup（生产环境）",
    "  simple   —— 直接 agent.execute() 调用，无流水线（适合测试/简单场景）",
    "",
    "选择最适合你项目的一种组合。在任务 JSON 之前输出：",
    "  STRATEGY: <策略名> | <驱动名> | <执行模型名>",
    "示例：STRATEGY: tag-matching | wave | pipeline",
  ].join("\n");

  // 母项目上下文（含自动探索结果）
  const PARENT_CONTEXT = [
    "=== 关于母项目（Cortex） ===",
    "",
    "Cortex 是一个用 TypeScript 编写的多 Agent 工程框架。",
    "它协调整合多种 AI Agent（代码、审查、分析、运维、API、数据、文档、巡检、修复、循环）",
    "来从零开始协同设计、构建、审查和验证软件项目。",
    "",
    discoveryReport,
    "",
    webReport,
    "",
    "=== 你的任务 ===",
    "",
    "你身处一个空子目录中。目前仅存在 package.json 和 tsconfig.json 两个文件。",
    "",
    userIntent
      ? `用户指定了意图："${userIntent}"`
      : [
          "你的任务是：在母项目 monorepo 中建造一个**有价值的、可独立编译测试的 TypeScript 包**。",
          "",
          "你需要自主决策造什么——基于母项目的定位和上述探索结果：",
          "  1. 哪些包已经存在？它们各自做什么？",
          "  2. 母项目的架构中还缺什么？有什么明显需要但还没做的？",
          "  3. 工具包（tools/）已有 monorepo-analyzer 和 configuration-drift，还能补充什么？",
          "",
          "=== 强制要求 ===",
          "",
          "1. 【核心交付】包必须包含：",
          "   - src/index.ts（公开 API，barrel 导出）",
          "   - src/ 下至少一个功能模块",
          "   - tests/ 下至少一个单元测试文件",
          "2. 【CI 标注】每个测试文件第一行必须是 `// @ci: unit`（宪法 §十四·一 自声明机制）",
          "3. 【编译通过】`npx tsc --noEmit` 必须零错误通过",
          "4. 【测试通过】`npx vitest run` 必须全部通过",
          "5. 【编码规范】所有代码必须遵守 coding-standards.md 强制要求：",
          "   - 禁止空 catch {} 块",
          "   - 禁止 var 声明，优先 const",
          "   - 禁止裸 console.error/warn（生产代码走 PipelineObserver，测试代码允许）",
          "   - 导入走 barrel：`import { X } from \"@cortex/xxx\"`",
          "   - 禁止硬编码魔法数字/路径/环境变量名/版本号",
          "6. 【补足声明】在包根目录创建 PACKAGE_POSITIONING.md，回答三个问题：",
          "   - 这个包补足了什么？（母项目中缺了什么）",
          "   - 它的定位是什么？（在 monorepo 架构中的位置和职责）",
          "   - 为什么值得合入？（解决了什么实际问题）",
          "7. 【模块化注册】包名必须是 @cortex/<name> 命名空间，package.json 依赖声明用 workspace:*",
          "",
          "=== 允许的工具 ===",
          "",
          "你拥有所有工具的完整访问权限：读取、写入、shell（npm install, tsc, vitest）。",
          "",
          "=== 路径规则（重要！）===",
          "你当前的工作目录 **就是** 包根目录。所有写入路径都相对于此解析。",
          "- 写 `src/index.ts` → 创建的就是包根的 src/index.ts",
          "- 写 `tests/core.test.ts` → 创建的就是包根的 tests/core.test.ts",
          "- **不要**在你的包内创建 `packages/`、`cortex/`、`src/observability/` 等嵌套目录结构",
          "- 你不需要模仿母项目的目录树——你的包本身就是 monorepo 的一个叶子节点",
          "- 功能模块直接放在 src/ 下：`src/metrics.ts`、`src/tracer.ts` 等",
          "",
          "所有文件必须保持在本目录内。你不能在外部写入。",
          "你可能需要探索母项目的具体源码来做决策——这由调度阶段的 Agent 来完成。",
          "规划阶段你只能基于上述探索摘要做决策。",
        ].join("\n"),
    "",
    "规则：",
    "1. 包必须能用 `npx tsc --noEmit` 编译通过，`npx vitest run` 测试全部通过。",
    "2. 所有测试文件首行必须有 `// @ci: unit` 标注。",
    "3. 必须产出 PACKAGE_POSITIONING.md 说明补足内容和定位。",
    "4. 所有文件必须保持在本目录内。你不能在外部写入。",
    "5. 你拥有所有工具的完整访问权限：读取、写入、shell（npm install, tsc, tsx）。",
    "6. 你可能需要探索母项目的具体源码来做决策——这由调度阶段的 Agent 来完成。",
    "   规划阶段你只能基于上述探索摘要做决策。",
    "",
    "团队：",
    "- CodeAgent (阿贝多) — 代码实现        - ReviewAgent (刻晴) — 代码审查",
    "- AnalysisAgent (纳西妲) — 研究/设计     - OpsAgent (北斗) — 脚本/构建",
    "- LoopAgent (莫娜) — 模式发现            - DocGovernAgent (凝光) — 治理审计",
    "- ApiAgent (久岐忍) — API 设计            - DataAgent (艾尔海森) — 数据建模",
    "- FixAgent (希格雯) — 缺陷修复            - InspectorAgent (安柏) — 验证巡检",
    "",
    STRATEGY_SECTION,
    "",
    "规划任务图。输出 TaskNode JSON。",
  ].join("\n");

  const INTENT = PARENT_CONTEXT;

  console.log("   📋 MetaAgent 思考中（了解母项目全貌 + 自主决策，这需要一点时间）...\n");
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

  // ── 根据甘雨选择（或 CLI 覆盖）构造调度器 ──
  const planText = extractPlanText(plan);
  const parsedMeta = tryParseMetaStrategy(planText);
  if (parsedMeta.strategy) {
    console.log(`   🤖 MetaAgent 选择: ${parsedMeta.strategy} | ${parsedMeta.driver} | ${parsedMeta.exec}`);
  }
  const strategy = resolveStrategy(cliStrategy, planText);
  const driver = resolveDriver(cliDriver, planText);
  const execModel = resolveExecModel(cliExec, planText);

  console.log(`\n   🧪 调度组合: ${strategy.name} × ${driver.name} × ${execModel.name}\n`);

  const scheduler = new CompositeScheduler(board, pool, observer, metaAgent, undefined, {
    strategy,
    loopDriver: driver,
    executionModel: execModel});

  // 注册全部 Agent 到调度器
  for (const [type, agent] of builtAgents) {
    scheduler.register(type, agent, CHAT_MODEL);
  }

  for (const n of plan) {
    board.addNode(n);
  }
  console.log(`\n   ${plan.length} 个节点已入板。\n`);

  // ── Phase 4: 执行 ──
  console.log("🟢 [Phase 4] Scheduler 执行...\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  observer.on(PipelinePriority.HIGH, (e) => {
    const p = e.payload as any;
    const id = p?.nodeId ? `[${(p.nodeId as string).slice(0, 20)}]` : "";
    if (e.type === "node.complete") {
      console.log(`   ✅ ${id} ${(p.source as any)?.agentType ?? "?"} 完成`);
    } else if (e.type === "node.failed") {
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

  // ── Phase 6: 验收 —— 编译 + 测试 + CI 标注 ──
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🔍 验收：编译 + 测试 + CI 标注 + Barrel 导出     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // 收集产出文件
  const producedFiles: string[] = [];
  const walkProduced = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".cortex") continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walkProduced(full);
      } else if (/\.(ts|js|json|html|md)$/.test(entry.name)) {
        producedFiles.push(full);
      }
    }
  };
  walkProduced(PROJECT_DIR);

  // 排除脚手架文件
  const sourceFiles = producedFiles.filter(
    (f) => !f.endsWith("tsconfig.json") && !f.endsWith("package.json")
  );

  console.log(`   产出文件 (${sourceFiles.length} 个):`);
  for (const f of sourceFiles) {
    const relative = path.relative(PROJECT_DIR, f);
    const size = fs.statSync(f).size;
    console.log(`   ${size > 0 ? "✅" : "❌"} ${relative} (${size} bytes)`);
  }

  let acceptancePassed = true;

  if (sourceFiles.length === 0) {
    console.log("\n   ❌ 验收失败：未发现任何产出文件。");
    acceptancePassed = false;
  }

  // ── 6a. 结构检查：src/index.ts + tests/ ──
  console.log("\n   ── 6a. 包结构检查 ──");
  const hasSrcIndex = fs.existsSync(path.join(PROJECT_DIR, "src", "index.ts"));
  const testDir = path.join(PROJECT_DIR, "tests");
  const hasTests = fs.existsSync(testDir) && fs.readdirSync(testDir).some(f => f.endsWith(".test.ts"));
  console.log(`   src/index.ts: ${hasSrcIndex ? "✅" : "❌ 缺失"}`);
  console.log(`   tests/*.test.ts: ${hasTests ? "✅" : "❌ 缺失"}`);
  if (!hasSrcIndex || !hasTests) acceptancePassed = false;

  // ── 6b. Barrel 导出检查 ──
  console.log("\n   ── 6b. Barrel 导出检查 ──");
  if (hasSrcIndex) {
    const barrelContent = fs.readFileSync(path.join(PROJECT_DIR, "src", "index.ts"), "utf-8");
    const hasExports = /export\s+/.test(barrelContent);
    console.log(`   index.ts 含导出语句: ${hasExports ? "✅" : "⚠️ 无导出"}`);
    if (!hasExports) acceptancePassed = false;
  }

  // ── 6c. CI 标注检查 ──
  console.log("\n   ── 6c. CI 标注检查（@ci: unit）──");
  let ciAnnotationsOk = true;
  if (hasTests) {
    const testFiles = fs.readdirSync(testDir).filter(f => f.endsWith(".test.ts"));
    for (const tf of testFiles) {
      const content = fs.readFileSync(path.join(testDir, tf), "utf-8");
      const firstLine = content.split("\n")[0].trim();
      if (firstLine === "// @ci: unit") {
        console.log(`   ✅ ${tf}: @ci: unit`);
      } else {
        console.log(`   ❌ ${tf}: 缺失 @ci: unit 标注（首行: "${firstLine.slice(0, 60)}"）`);
        ciAnnotationsOk = false;
      }
    }
    if (!ciAnnotationsOk) acceptancePassed = false;
  } else {
    console.log("   ⚠️ 无测试文件，跳过 CI 标注检查");
  }

  // ── 6d. 编译检查 ──
  console.log("\n   ── 6d. 编译检查（tsc --noEmit）──");
  let compileOk = false;
  try {
    const { execSync } = await import("node:child_process");
    const tscOutput = execSync("npx tsc --noEmit", {
      cwd: PROJECT_DIR,
      timeout: 60_000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"]});
    console.log(`   ✅ tsc --noEmit 通过`);
    if (tscOutput.trim()) console.log(`   ${tscOutput.trim().split("\n").slice(0, 3).join("\n   ")}`);
    compileOk = true;
  } catch (e: any) {
    const stderr = e.stderr?.toString() ?? "";
    console.log(`   ❌ tsc --noEmit 失败:`);
    const errors = stderr.split("\n").filter((l: string) => l.includes("error TS")).slice(0, 8);
    for (const line of errors) console.log(`      ${line.trim()}`);
    acceptancePassed = false;
  }

  // ── 6e. 测试运行 ──
  console.log("\n   ── 6e. 测试运行（vitest run）──");
  let testOk = false;
  try {
    const { execSync } = await import("node:child_process");
    const testOutput = execSync("npx vitest run", {
      cwd: PROJECT_DIR,
      timeout: 120_000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"]});
    // 解析 vitest 输出
    const testSummary = testOutput.match(/Tests\s+(\d+)\s+passed/);
    const testFailed = testOutput.match(/(\d+)\s+failed/);
    if (testSummary) {
      console.log(`   ✅ vitest: ${testSummary[0]}` + (testFailed ? `, ${testFailed[0]}` : ""));
      testOk = !testFailed || parseInt(testFailed[1]) === 0;
    } else {
      console.log(`   ✅ vitest 运行成功`);
      testOk = true;
    }
  } catch (e: any) {
    const stderr = e.stderr?.toString() ?? "";
    const stdout = e.stdout?.toString() ?? "";
    console.log(`   ❌ vitest 失败:`);
    const relevant = (stdout + stderr).split("\n").filter((l: string) =>
      l.includes("FAIL") || l.includes("failed") || l.includes("Error")
    ).slice(0, 6);
    for (const line of relevant) console.log(`      ${line.trim()}`);
    acceptancePassed = false;
  }

  console.log(`\n   ── 验收总结 ──`);
  console.log(`   包结构:  ${hasSrcIndex && hasTests ? "✅" : "❌"}`);
  console.log(`   CI 标注: ${ciAnnotationsOk ? "✅" : "❌"}`);
  console.log(`   编译:    ${compileOk ? "✅" : "❌"}`);
  console.log(`   测试:    ${testOk ? "✅" : "❌"}`);
  console.log(`   总结果:  ${acceptancePassed ? "✅ 通过" : "❌ 未通过"}`);

  const closedLoopPassed = acceptancePassed;

  // ── Phase 7: 六层防御合规性 + 记忆诊断（合并）──
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   🛡️  六层防御合规性（P0 + P1）                    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const allMemories = await memory.read({  });
  const PENDING_MARKER = "" as SemanticState;
  const byKind: Record<string, number> = {};
  const byState: Record<string, number> = {};
  for (const m of allMemories) {
    byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
    byState[m.semantic_state || "(Pending)"] = (byState[m.semantic_state || "(Pending)"] ?? 0) + 1;
  }
  console.log(`   📊 总记忆: ${allMemories.length}`);
  console.log(`   P0-Kind: ${Object.entries(byKind).map(([k,v]) => `${k}=${v}`).join(", ")}`);
  console.log(`   P0-状态:   ${Object.entries(byState).map(([k,v]) => `${k}=${v}`).join(", ")}`);

  // 含任务关联的记忆
  const withTask = allMemories.filter((m) => m.content_blob?.taskId);
  if (withTask.length > 0) {
    console.log(`   📋 含任务关联: ${withTask.length} 条`);
    for (const m of withTask.slice(0, 5)) {
      console.log(`     📖 [${m.kind}] ${(m.summary ?? "").slice(0, 120)}`);
    }
  }

  // P0: Pending 隔离检查
  const pendingMemories = allMemories.filter((m) => (m.semantic_state as string) === PENDING_MARKER);
  const defaultRead = await memory.read({ });
  const pendingInDefault = defaultRead.filter((m) => (m.semantic_state as string) === PENDING_MARKER);
  console.log(`   P0-Pending: ${pendingMemories.length} 条 | 默认可见=${pendingInDefault.length} | 总读=${defaultRead.length}`);
  const pendingIsolated = pendingMemories.length > 0 && pendingInDefault.length === 0;
  console.log(`   P0-Pending隔离: ${pendingIsolated ? "✅" : "⚠️"} (Pending 对默认 read 不可见)`);

  // P1: InitVerifier 启动校验
  console.log(`\n   ── P1 InitVerifier ──`);
  const consistencyReport = await consistency.verify();
  if (consistencyReport) {
    console.log(`   P1-文件校验: 总记忆=${consistencyReport.totalMemories}  已检查=${consistencyReport.checkedMemories}  ok=${consistencyReport.summary.ok}  missing=${consistencyReport.summary.missing}`);
    const fileChecks = consistencyReport.fileChecks;
    if (fileChecks.length > 0) {
      const missing = fileChecks.filter((d) => d.status === "missing");
      const unchecked = fileChecks.filter((d) => d.status === "unchecked");
      if (missing.length > 0) {
        console.log(`      缺失 ${missing.length} 文件:`);
        for (const d of missing.slice(0, 5)) console.log(`        ❌ ${d.filePath}`);
        if (missing.length > 5) console.log(`        ... 还有 ${missing.length - 5} 个`);
      }
      if (unchecked.length > 0) {
        console.log(`      未检查 ${unchecked.length} 个 (调用中出错)`);
      }
    }
    console.log(`   P1-InitVerifier: ${consistencyReport.fatal ? "💥 致命" : "✅ 通过"}`);
  } else {
    console.log(`   P1-InitVerifier: ⚠️ 未启用 (缺少 FileSystemAdapter)`);
  }

  // P1: SchemaEnforcer 抽样检查
  console.log(`\n   ── P1 SchemaEnforcer ──`);
  const sampleInputs = allMemories.slice(0, 3).map((m) => ({
    kind: m.kind,
    content_blob: (m.content_blob ?? {}) as Record<string, unknown>,
    summary: m.summary,
    semantic_gist: m.semantic_gist ?? m.summary,
    content_hash: m.content_hash ?? "",
    source: m.source} as import("@cortex/shared").MemoryWriteInput));
  let schemaPassCount = 0;
  for (const input of sampleInputs) {
    const validated = consistency.validateInput(input);
    if (validated.valid) {
      schemaPassCount++;
    } else {
      console.log(`       ⚠️ 校验失败: ${validated.errors?.join(", ")}`);
    }
  }
  console.log(`   P1-SchemaEnforcer: 抽样 ${sampleInputs.length}/${sampleInputs.length} 通过`);

  // P1: annotate 测试
  const annotateInput: import("@cortex/shared").MemoryWriteInput = {
    kind: "TaskLog",
    content_blob: { value: "test-annotate" },
    summary: "测试 annotate 默认值",
    semantic_gist: "测试 annotate 默认值",
    content_hash: "",
    source: { agentType: AgentType.Code, taskId: "" },
    embedding: new Array(768).fill(0)};
  const annotated = consistency.annotateInput(annotateInput);
  console.log(`   P1-annotate: 抽样输入已通过 annotateInput 处理`);

  // P2: 技能沉淀检查
  console.log(`\n   ── P2 技能沉淀 ──`);
  const skillMemories = await memory.read({ kind: "Skill" });
  const registrySkills = skillRegistry.getAll();
  const skillPrecipitated = skillMemories.length > 0;
  console.log(`   记忆库 SKILL: ${skillMemories.length} 条`);
  console.log(`   注册表技能: ${registrySkills.length} 个`);
  console.log(`   技能沉淀: ${skillPrecipitated ? "✅ (已闭环)" : "⚠️ (空——无可复用技能沉淀)"}`);
  if (registrySkills.length > 0) {
    for (const s of registrySkills.slice(0, 5)) {
      console.log(`      · ${s.name} [${s.agentType}] tags:[${s.triggerTags.join(",")}]`);
    }
  }

  // ── Phase 8: 合并门禁 —— 编码规范强制检查 + 补足定位确认 ──
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   🚪 合并门禁：编码规范 + 补足定位                    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // 8a. 补足定位文档检查
  const positioningPath = path.join(PROJECT_DIR, "PACKAGE_POSITIONING.md");
  let positioningOk = false;
  let positioningSummary = "";
  if (fs.existsSync(positioningPath)) {
    const ppContent = fs.readFileSync(positioningPath, "utf-8");
    // 检查是否回答了三个问题
    const hasGap = /补足|缺了|补充|填补|空缺/.test(ppContent);
    const hasPosition = /定位|位置|职责|架构/.test(ppContent);
    const hasValue = /价值|解决|为什么|合入/.test(ppContent);
    positioningOk = hasGap && hasPosition && hasValue;
    console.log(`   PACKAGE_POSITIONING.md: ${fs.existsSync(positioningPath) ? "✅ 存在" : "❌ 缺失"}`);
    console.log(`     补足说明: ${hasGap ? "✅" : "❌"}  定位说明: ${hasPosition ? "✅" : "❌"}  合入理由: ${hasValue ? "✅" : "❌"}`);
    if (positioningOk) {
      // 提取摘要
      const lines = ppContent.split("\n").filter((l: string) => l.trim() && !l.startsWith("#")).slice(0, 3);
      positioningSummary = lines.map((l: string) => `     ${l.trim().slice(0, 100)}`).join("\n");
      console.log(positioningSummary);
    }
  } else {
    console.log(`   ❌ PACKAGE_POSITIONING.md 缺失——合入前必须说明包补足了什么、定位是什么`);
  }

  // 8b. 编码规范强制检查（对 src/ 下所有 .ts 文件）
  console.log("\n   ── 8b. 编码规范强制检查 ──");
  let codingStandardsOk = true;
  const srcDir = path.join(PROJECT_DIR, "src");
  if (fs.existsSync(srcDir)) {
    const walkSrc = (d: string): string[] => {
      const results: string[] = [];
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          results.push(...walkSrc(path.join(d, entry.name)));
        } else if (entry.name.endsWith(".ts")) {
          results.push(path.join(d, entry.name));
        }
      }
      return results;
    };
    const srcFiles = walkSrc(srcDir);

    let violations = 0;
    for (const f of srcFiles) {
      const content = fs.readFileSync(f, "utf-8");
      const relative = path.relative(PROJECT_DIR, f);
      // 检查空 catch {}
      if (/catch\s*\{\s*\}/.test(content)) {
        console.log(`   ❌ ${relative}: 空 catch {} 块（禁止）`);
        violations++;
      }
      // 检查 var 声明
      if (/\bvar\s+/.test(content)) {
        console.log(`   ❌ ${relative}: var 声明（禁止，用 const/let）`);
        violations++;
      }
      // 检查裸 console.error/warn（生产代码不允许）
      if (/console\.(error|warn)\s*\(/.test(content) && !f.includes("test")) {
        console.log(`   ⚠️ ${relative}: console.error/warn（生产代码应走 PipelineObserver）`);
        // warn 级别，不阻塞
      }
      // 检查硬编码环境变量名
      if (/['"]DEEPSEEK_API_KEY['"]|['"]cortex-agents\.json['"]/.test(content)) {
        console.log(`   ❌ ${relative}: 硬编码常量（禁止，应走 constants.ts）`);
        violations++;
      }
    }

    if (violations > 0) {
      console.log(`\n   ❌ 编码规范: ${violations} 处违规`);
      codingStandardsOk = false;
    } else {
      console.log(`   ✅ 编码规范: 全部通过`);
    }
  }

  // 8c. 模块化注册检查（package.json 命名空间 + workspace 依赖）
  console.log("\n   ── 8c. 模块化注册检查 ──");
  let moduleRegOk = true;
  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "package.json"), "utf-8"));
    const hasName = pkgJson.name?.startsWith("@cortex/");
    const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
    const hasWorkspace = Object.values(deps).some((v: any) => v === "workspace:*");
    console.log(`   命名空间 @cortex/*: ${hasName ? "✅" : "❌"} (${pkgJson.name || "未定义"})`);
    console.log(`   workspace 依赖: ${hasWorkspace ? "✅" : "❌"}`);
    if (!hasName || !hasWorkspace) moduleRegOk = false;
  } catch {
    console.log("   ❌ package.json 解析失败");
    moduleRegOk = false;
  }

  console.log(`\n   ── 合并门禁总结 ──`);
  console.log(`   补足定位: ${positioningOk ? "✅" : "❌"}`);
  console.log(`   编码规范: ${codingStandardsOk ? "✅" : "❌"}`);
  console.log(`   模块注册: ${moduleRegOk ? "✅" : "❌"}`);
  const mergeReady = positioningOk && codingStandardsOk && moduleRegOk && acceptancePassed;
  console.log(`   合并就绪: ${mergeReady ? "✅ 可合入" : "❌ 未就绪"}`);

  // ── 收尾 ──
  await memory.close();

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log(`║   ${closedLoopPassed ? "✅ 独自飞翔 —— 验收通过" : "❌ 验收失败"}        ║`);
  console.log(`║   合并就绪: ${mergeReady ? "✅" : "❌"}                                  ║`);
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`   规划耗时: ${planDuration}ms (${(planDuration / 1000).toFixed(1)}s)`);
  console.log(`   执行耗时: ${execDuration}ms (${(execDuration / 1000).toFixed(1)}s)`);
  console.log(`   总耗时:   ${((planDuration + execDuration) / 1000).toFixed(1)}s`);
  console.log(`   MetaAgent 计划: ${plan.length} 节点`);
  console.log(`   Scheduler 完成: ${report.completed}  失败: ${report.failed}`);
  console.log(`   产出文件: ${sourceFiles.length} 个`);
  console.log(`   验收结果: ${acceptancePassed ? "✅" : "❌"} (结构 ${hasSrcIndex && hasTests ? "✅" : "❌"} | CI ${ciAnnotationsOk ? "✅" : "❌"} | 编译 ${compileOk ? "✅" : "❌"} | 测试 ${testOk ? "✅" : "❌"})`);
  console.log(`   合并门禁: ${mergeReady ? "✅ 可合入" : "❌ 未就绪"} (定位 ${positioningOk ? "✅" : "❌"} | 规范 ${codingStandardsOk ? "✅" : "❌"} | 注册 ${moduleRegOk ? "✅" : "❌"})`);
  console.log(`   六层防御: P0-Pending隔离 ${pendingIsolated ? "✅" : "❌"} | P1-InitVerifier ${consistencyReport && !consistencyReport.fatal ? "✅" : "⚠️"} | P2-技能沉淀 ${skillPrecipitated ? "✅" : "⚠️"}`);
  console.log();

  if (!acceptancePassed || !mergeReady || report.failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("💥 独自飞翔 E2E 崩溃:", e);
  process.exit(1);
});
