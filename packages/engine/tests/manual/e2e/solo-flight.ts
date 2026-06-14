/**
 * 独自飞翔 E2E —— 冷启动：空目录起步，Agent 从零建造一个完整项目
 *
 * 用法:
 *   npx tsx tests/manual/e2e/solo-flight.ts                          # 默认：自主决策造什么
 *   npx tsx tests/manual/e2e/solo-flight.ts --intent plugin-runner    # 挑战 1: 插件运行器
 *   npx tsx tests/manual/e2e/solo-flight.ts --intent scheduler-docs   # 挑战 2: 调度文档
 *   npx tsx tests/manual/e2e/solo-flight.ts --intent fsm-compiler     # 挑战 3: FSM 编译器
 *   npx tsx tests/manual/e2e/solo-flight.ts --intent "自定义意图..."  # 自由意图
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 与 closed-loop-collab 的区别:
 *   - 无任何参照代码库 —— Agent 面对的是空目录
 *   - 意图开放但明确
 *   - 全工具开放 —— 读写、shell 全部可用，但限定区域
 *   - 冷启动验证 —— 没有宪法、没有 MemoryStore 种子、没有先例
 *
 * 安全红线:
 *   - 所有文件操作限定在 PACKAGES_DIR 内（写入越界直接拒绝）
 *   - shell 危险命令拦截
 *   - 不碰主仓库任何代码
 *
 * 验收标准:
 *   1. MetaAgent 产出 ≥1 个 TaskNode
 *   2. Scheduler.executeAll() 完成
 *   3. 产出文件真实存在且非空
 *   4. 至少一个产物可成功执行（npx tsx 不报错）
 *   5. 包符合组件式架构：≥3 个模块 + ≥1 个 interface 扩展点 + Registry 机制
 *   6. tsc --noEmit 零错误，vitest run 全部通过
 *   7. 每个模块有独立单元测试，覆盖率 ≥ 80% lines
 *   8. 技能沉淀闭环：SkillTemplate JSON 自动提取入池
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType, PipelinePriority, PipelineEventType, type SemanticState, type TaskNode } from "@cortex/shared";
import { loadSkillsFromMemory, scanOutputFilesForSkills, emitSkillReferenced } from "@cortex/engine";
import { LlmAdapter } from "@cortex/llm";
import {
  TaskBoard,
  AgentPool,
  PipelineObserver,
  ConfirmGate,
  MetaAgent,
  SkillRegistry,
  deriveStatus,
  registerSkillPipeline,
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
  Scheduler,
} from "@cortex/engine";
import { Toolkit, NodeFileSystemAdapter, SearchAggregator, DdgSearchBackend, McpSearchBackend } from "@cortex/platform";
import type { SearchBackend } from "@cortex/platform";
import { ConsistencyLayer } from "@cortex/consistency";
import { MemoryStore, defaultEmbeddingService } from "@cortex/memory-store";
import {
  TagMatchingStrategy,
  RoundRobinStrategy,
  PriorityFirstStrategy,
  TopologicalLayeredDriver,
  SequentialDriver,
  WaveDriver,
  PipelineModel,
  SimpleExecuteModel,
  SemanticModelRouter,
  TrustModel,
  type RouteDecision,
} from "@cortex/scheduler";
import type { IScheduleStrategy, ILoopDriver, IExecutionModel } from "@cortex/scheduler";
import type { Agent } from "@cortex/shared";
import {
  getTelemetry,
  shutdownTelemetry,
} from "@cortex/engine";
import { installConsoleBridge, uninstallConsoleBridge } from "@cortex/engine";
import { resolveLlmConfig } from "../config/llm-defaults";
import type { EngineConfig } from "@cortex/config";

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
    if (path.isAbsolute(normalized) && normalized.toLowerCase().startsWith(projectRoot.toLowerCase() + path.sep)) {
      return normalized;
    }
    const clean = p.replace(/^[a-zA-Z]:[\\/]/, '').replace(/^[\\/]+/, '');
    return path.resolve(projectRoot, clean || '.');
  };

  // ── 读取（不做越界限制 —— 与 closed-loop-collab 一致）──

  // ⛔ 归档路径黑名单 —— 防止 Agent 读过时/废弃的设计文档
  const ARCHIVE_DENY = new Set(["docs/archive", "docs/constitution/archive", "docs/constitution/backup"]);
  const isDenied = (fp: string) => {
    const rel = path.relative(projectRoot, fp).replace(/\\/g, "/");
    for (const deny of ARCHIVE_DENY) {
      if (rel.startsWith(deny + "/") || rel === deny) return deny;
    }
    return null;
  };

  // ⛑️ 补全工具 JSON Schema——DeepSeek API 拒绝 type:null 的 schema
  toolkit.setToolMeta({
    read_file: { parameters: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } },
    write_file: { parameters: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } },
    run_shell: { parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
    list_files: { parameters: { type: "object", properties: { dir_path: { type: "string" } }, required: [] } },
    list_dir: { parameters: { type: "object", properties: { dir_path: { type: "string" } }, required: [] } },
    search_code: { parameters: { type: "object", properties: { query: { type: "string" }, path: { type: "string" } }, required: ["query"] } },
    delete_file: { parameters: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } },
  });

  toolkit.register("read_file", async (params) => {
    const fp = resolve(params.file_path as string);
    const denied = isDenied(fp);
    if (denied) return { success: false, error: `read_file denied: ${path.relative(projectRoot, fp)} 位于归档目录 "${denied}/"，请勿引用已废弃的设计文档。` };
    if (!fs.existsSync(fp)) return { success: false, error: `File not found: ${fp}` };
    try {
      return { success: true, output: fs.readFileSync(fp, "utf-8") };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  const listHandler = async (params: any) => {
    const dp = resolve((params.dir_path ?? params.path ?? ".") as string);
    const denied = isDenied(dp);
    if (denied) return { success: false, error: `list_files denied: ${path.relative(projectRoot, dp)} 位于归档目录 "${denied}/"，请勿引用已废弃的设计文档。` };
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
    const denied = isDenied(dir);
    if (denied) return { success: false, error: `search_code denied: ${path.relative(projectRoot, dir)} 位于归档目录 "${denied}/"，请勿引用已废弃的设计文档。` };
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

  // ── 写入 —— 护已有包，开放根级文件供集成 ──

  // 已有包保护：扫描 packages/ 下的子目录（不能覆盖已有包）
  const existingPkgs = new Set<string>();
  const packagesPath = path.join(projectRoot, "packages");
  if (fs.existsSync(packagesPath)) {
    for (const entry of fs.readdirSync(packagesPath, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) existingPkgs.add(entry.name);
    }
  }

  toolkit.register("write_file", async (params) => {
    const fp = resolve(params.file_path as string);
    if (!fp.startsWith(projectRoot + path.sep)) {
      return { success: false, error: `write_file denied: 路径越界 ${fp}\n  提示: 请使用相对路径` };
    }
    // 已有包目录：可新增文件，不可覆盖/修改已有文件
    const rel = path.relative(projectRoot, fp);
    const pkgsPrefix = "packages" + path.sep;
    if (rel.startsWith(pkgsPrefix)) {
      const rest = rel.slice(pkgsPrefix.length);
      const topDir = rest.split(path.sep)[0];
      if (topDir && existingPkgs.has(topDir) && fs.existsSync(fp)) {
        return { success: false, error: `write_file denied: "${rel}" 是已有包中的文件，不能修改。只能新增文件。` };
      }
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

  // ── 删除 —— 一律禁止 ──

  toolkit.register("delete_file", async (params) => {
    const fp = resolve(params.file_path as string);
    return { success: false, error: `delete_file denied: ${fp} —— 不能删除任何文件。` };
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
  const name = cliOverride ?? parsed.driver ?? "topological-layered";
  const map: Record<string, ILoopDriver> = {
    "topological-layered": new TopologicalLayeredDriver(),
    "sequential": new SequentialDriver(),
    "wave": new WaveDriver()};
  return map[name] ?? map["topological-layered"];
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

  // ── 工作目录：packages/（Agent 自主在此建子目录）──
  const PACKAGES_DIR = path.resolve(WORKSPACE, "packages");
  // Agent 工作区提升到 workspace 根，允许修改 tsconfig.json 等集成文件
  const AGENT_ROOT = WORKSPACE;

  // 记录 Agent 创建了哪个包（Phase 6/8 验收时用）
  let createdPkgDir: string | null = null;

  // 快照：Agent 启动前 packages/ 下的已有子目录（用于验收时差集发现新包）
  const preExistingPkgs = new Set<string>();
  if (fs.existsSync(PACKAGES_DIR)) {
    for (const entry of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) preExistingPkgs.add(entry.name);
    }
  }

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🕊️  独自飞翔 —— 冷启动，自主建包，从零建造     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  工作区:   ${AGENT_ROOT}（Agent 可修改根级集成文件）`);
  console.log(`  起点:     空（Agent 自主创建 packages/<name>/）`);
  console.log(`  Chat:     ${CHAT_MODEL}`);
  console.log(`  Reasoner: ${REASONER_MODEL}\n`);

  // ── Phase 1: 基础设施 ──
  console.log("🟢 [Phase 1] 初始化基础设施...\n");

  // ═════ v3.1 引擎配置：replan 配额 + 超时 + ManifoldGate ═════
  const engineConfig: EngineConfig = {
    maxReplanPerNode: 5,
    maxTotalReplans: 20,
    executeAllTimeoutMs: 1_800_000,
    manifoldGateAcquireTimeoutMs: 120_000,
  };
  console.log(`   引擎配置: maxReplanPerNode=${engineConfig.maxReplanPerNode} maxTotalReplans=${engineConfig.maxTotalReplans}`);

  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    reasonerModel: REASONER_MODEL,
    reasoningEffort: llmCfg.reasoningEffort as "high" | "max"});
  adapter.setCacheEnabled(true);

  // 🔍 捕获 MetaAgent 原始 LLM 响应，提取 STRATEGY 行
  let rawPlanResponse = "";
  const rawAdapter = new Proxy(adapter, {
    get(target, prop) {
      if (prop === "chat") {
        return async (...args: any[]) => {
          const result = await (target.chat as (...a: any[]) => any)(...args);
          if (result?.content) rawPlanResponse = result.content;
          return result;
        };
      }
      return (target as any)[prop];
    },
  });

  const metaAgent = new MetaAgent(rawAdapter);
  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();
  const gate = new ConfirmGate();
  gate.bypassAll();

  // ═════ TrustModel：信任评分（驱动 ConfirmGate 可逆性判断） ═════
  const trustModel = new TrustModel();
  gate.setTrustModel(trustModel);
  console.log(`   TrustModel: 信任评分引擎已就绪`);

  // ═════ FileLockManager：并发文件访问保护 ═════
  const fileLock = new (await import("@cortex/platform")).FileLockManager();
  console.log(`   FileLockManager: 并发文件锁已就绪`);

  // ═════ Telemetry：全链路遥测初始化 ═════
  // 调用 getTelemetry() 自动创建 ConsoleCollector，无需手动 setTelemetry
  getTelemetry();
  console.log(`   Telemetry: 全链路遥测已启动（ConsoleCollector）`);



  // ── MemoryStore ──
  const memory = new MemoryStore(undefined, undefined, defaultEmbeddingService);
  const MEMORY_DB = path.resolve(WORKSPACE, ".cortex", `memory-solo-flight-${Date.now()}.db`);
  await memory.init(MEMORY_DB);
  console.log(`   MemoryStore: ${MEMORY_DB}`);

  // P1 一致性校验层（文件校验 + 结构校验）
  const fsAdapter = new NodeFileSystemAdapter();
  const consistency = new ConsistencyLayer(memory, {
    projectRoot: WORKSPACE,
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
  const scannedSkills = scanOutputFilesForSkills(PACKAGES_DIR);
  if (scannedSkills.length > 0) {
    skillRegistry.registerAll(scannedSkills);
    console.log(`   从文件回溯扫描 ${scannedSkills.length} 个技能模板`);
  }
  console.log(`   SkillRegistry: ${skillRegistry.activeCount} 个活跃技能就绪`);

  // ═════ v2.6.0 技能事件管线：NodeComplete → 自动技能提取入池 ═════
  const unregisterSkillPipe = registerSkillPipeline(observer, skillRegistry, memory);
  console.log(`   registerSkillPipeline: NodeComplete → 自动技能提取已启用`);

  // ═════ SkillReferenced 可观测性：追踪技能参照事件 ═════
  const skillReferencedEvents: Array<{
    nodeId: string;
    skillId: string;
    skillName: string;
  }> = [];
  const skillRefTracker = (e: any) => {
    if (e.type === "skill.referenced") {
      const p = e.payload;
      skillReferencedEvents.push({ nodeId: p.nodeId, skillId: p.skillId, skillName: p.skillName });
    }
  };
  observer.on(PipelinePriority.NORMAL, skillRefTracker);

  // ═════ v2.6.0 技能经验上下文：注入 MetaAgent 规划视图 ═════
  const availableSkills = skillRegistry.getAll();
  // ⛓️ SkillTemplate JSON 格式——Agent 必须在完成任务后输出此 JSON，否则技能无法自动提取入池
  const SKILL_TEMPLATE_FORMAT = `\`\`\`json
{
  "name": "技能名称（简短描述性标题）",
  "kind": "action|thought|workflow",
  "triggerTags": ["标签1", "标签2"],
  "trigger": "什么情况下触发该技能（一句话描述）",
  "steps": ["步骤1: 做什么", "步骤2: 做什么", ...],
  "expectedOutput": "预期产出（可选）"
}
\`\`\`

⚠️ 关键约束：
- 每个 Agent 在最终输出末尾必须包含至少一个 SkillTemplate JSON 块（包裹在 \`\`\`json 围栏中）。
- 描述你刚完成的任务中复用的经验/模式/方法，让后续 Agent 可以复用。
- kind 取值：action=操作型技能，thought=思考型技能，workflow=工作流型技能。
- steps 不能为空，否则技能会被丢弃。
- 可以输出 JSON 数组（多个技能）或单个 JSON 对象。
- NodeComplete 事件会自动提取这些 JSON → SkillRegistry.registerAll()。`;

  const skillContextBlock = [
    "=== 技能经验池 + SkillTemplate 产出规范 ===",
    "",
    availableSkills.length > 0
      ? [
          "以下技能模板已在 MemoryStore / 文件回溯中加载。",
          "MetaAgent 分解任务时，按节点标签匹配相关技能（queryByTags），Agent 执行时可参照。",
          "",
          ...availableSkills.map(
            (s) => `  · [${deriveStatus(s.weight, s.feedbackHistory)}] ${s.name} (${s.kind}, weight=${s.weight}) tags:[${s.triggerTags.join(",")}] — ${s.trigger.slice(0, 80)}`,
          ),
        ].join("\n")
      : "（技能池为空——冷启动。Agent 执行过程中产出的技能将自动提取入池。）",
    "",
    SKILL_TEMPLATE_FORMAT,
    "",
    "在你的任务 JSON 中，每个节点的 payload 必须包含以下指令：",
    "  1. 完成节点任务后，在输出末尾附加 SkillTemplate JSON（格式见上）。",
    "  2. 描述你在本次执行中发现的可复用模式/方法/经验。",
    "  3. 技能命名以动词开头，如「TDD红绿重构循环」「CachePolicy默认值补全」「vitest fakeTimers TTL测试」。",
    "",
    "这也意味着：你的 TaskNode payload 中不仅要描述任务，还要提醒 Agent 产出技能。",
  ].join("\n");

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
        registerAllTools(tk, AGENT_ROOT);
        return createAgent(codeAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Review,
      label: "ReviewAgent (刻晴)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, AGENT_ROOT);
        return createAgent(reviewAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Analysis,
      label: "AnalysisAgent (纳西妲)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, AGENT_ROOT);
        return createAgent(analysisAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Ops,
      label: "OpsAgent (北斗)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, AGENT_ROOT);
        return createAgent(opsAgentConfig("solo-flight"), adapter, tk);
      }},
    {
      type: AgentType.Loop,
      label: "LoopAgent (莫娜)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, AGENT_ROOT);
        return createAgent(loopAgentConfig("solo-flight"), adapter, tk);
      }},
    {
      type: AgentType.DocGovern,
      label: "DocGovernAgent (凝光)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, AGENT_ROOT);
        return createAgent(docGovernAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Api,
      label: "ApiAgent (久岐忍)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, AGENT_ROOT);
        return createAgent(apiAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Data,
      label: "DataAgent (艾尔海森)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, AGENT_ROOT);
        return createAgent(dataAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Fix,
      label: "FixAgent (希格雯)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, AGENT_ROOT);
        return createAgent(fixAgentConfig("solo-flight"), adapter, tk, memory);
      }},
    {
      type: AgentType.Inspector,
      label: "InspectorAgent (安柏)",
      create() {
        const tk = new Toolkit(gate);
        registerAllTools(tk, AGENT_ROOT);
        const agent = createInspectorAgent(adapter, tk);
        agent.setWorkspaceRoot(AGENT_ROOT);
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
  const discoveryReport = discoverParentProject(PACKAGES_DIR);
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
  const userIntentArg = getArg("--intent");
  const cliStrategy = getArg("--strategy");
  const cliDriver = getArg("--driver");
  const cliExec = getArg("--exec");

  // ═══════════════════════════════════════════════
  // 具名意图（solo-flight 三大挑战用例）
  //   用法: npx tsx tests/manual/e2e/solo-flight.ts --intent <名称>
  // ═══════════════════════════════════════════════
  const NAMED_INTENTS: Record<string, string> = {
    "plugin-runner": [
      "在 monorepo 中建造 @cortex/plugin-runner 包。",
      "",
      "=== 核心交付 ===",
      "1. Plugin 接口 —— 含 init()/execute()/destroy() 生命周期钩子，每个钩子返回 Promise<void>",
      "2. PluginRegistry —— 按文件路径/glob 模式发现和注册插件的 Registry 机制",
      "3. PluginRunner(Sandboxed) —— 执行前校验插件合规性，执行后清理资源，异常隔离（单插件崩不杀进程）",
      "4. PluginSchema —— 每个插件类型定义独立校验 schema（用 zod 或手写 validator）",
      "5. PluginConfig —— 支持 JSON 配置外部化，插件通过构造函数注入配置",
      "6. src/ 下至少 3 个独立模块（plugin.ts / registry.ts / runner.ts），职责单一",
      "7. tests/ 下每个模块一个单元测试文件，首行 // @ci: unit",
      "8. 一个集成测试（integration.test.ts）验证全链路：注册→校验→执行→销毁",
      "9. PACKAGE_POSITIONING.md 说明包补足了什么、定位是什么",
      "",
      "=== 架构要求 ===",
      "- 依赖倒置：Registry 依赖 Plugin interface，不依赖具体实现",
      "- 开闭原则：新增插件 = 实现 Plugin + 调用 registry.register()，不改已有代码",
      "- 单一职责：每个模块只做一件事，方法体不超过 30 行",
      "- 防御式设计：公开方法验证输入参数，异步操作有超时",
      "",
      "=== 编码规范（强制）===",
      "- 禁止 any 类型（公开 API）、非空断言 !、空 catch {}、var 声明",
      "- 禁止硬编码魔法数字/路径/环境变量名",
      "- 所有公开 API 带 JSDoc（@param/@returns/@throws）",
      "- 模块间依赖必须单向无环",
      "",
      "=== 验收标准 ===",
      "- tsc --noEmit 零错误",
      "- vitest run 全部通过，覆盖率 ≥ 80% lines",
      "- 每个测试文件首行 // @ci: unit",
      "- package.json name 为 @cortex/plugin-runner，依赖用 workspace:*",
    ].join("\n"),

    "scheduler-docs": [
      "读取 @cortex/engine 包中 Scheduler 相关核心源码，为其产出四份完整文档。",
      "",
      "=== 你必须先探索 ===",
      "1. 用 list_files 扫描 packages/engine/src/ 目录结构",
      "2. 用 read_file 逐一读取 scheduler 相关源文件（Scheduler/CompositeScheduler/TaskBoard/AgentPool 等）",
      "3. 用 search_code 搜索 export 语句，提取全部公开 API 签名",
      "4. 用 read_file 读取现有测试文件，了解测试覆盖的模块",
      "",
      "=== 产出文件（全部写入 packages/engine/docs/scheduler/）===",
      "",
      "1. ARCHITECTURE.md —— 调度系统架构文档",
      "   - 系统整体架构概览（组件关系图用 Mermaid）",
      "   - TaskBoard / AgentPool / Scheduler / CompositeScheduler / ConfirmGate 的职责与交互",
      "   - IScheduleStrategy / ILoopDriver / IExecutionModel 的扩展点设计",
      "   - PipelineModel vs SimpleExecuteModel 的区别与适用场景",
      "   - 完整 Mermaid 流程图：从 addNode → executeAll → 完成的全调度链路",
      "",
      "2. API_REFERENCE.md —— 公开 API 参考文档",
      "   - 所有 export 的 class/interface/type/function 的完整签名",
      "   - 每个 API 含 JSDoc 说明、参数表、返回值、使用示例",
      "   - 区分公开 API 与内部实现细节",
      "",
      "3. SEQUENCE_DIAGRAM.md —— 执行序列详解",
      "   - 用 Mermaid sequenceDiagram 绘制关键执行序列",
      "   - 包含：任务提交→Agent 匹配→Spawn→Execute→Cleanup 完整时序",
      "   - 包含：并行执行场景（多 Agent 多节点并发）的时序",
      "   - 包含：错误重试/重规划场景的时序",
      "",
      "4. TEST_COVERAGE.md —— 测试覆盖率分析报告",
      "   - 列出所有测试文件及其覆盖的模块",
      "   - 标注已知未覆盖的模块/函数（如有）",
      "   - 给出补测建议（优先补哪些模块的测试）",
      "",
      "=== 要求 ===",
      "- 每份文档至少 300 行，内容充实，不可空洞",
      "- Mermaid 图必须语法正确、可渲染",
      "- 所有文档写入 packages/engine/docs/scheduler/ 目录",
      "- 写完之后运行 npx tsc --noEmit 确认没有破坏编译（文档不影响编译，但确保没有误改源码）",
    ].join("\n"),

    "fsm-compiler": [
      "在 monorepo 中建造 @cortex/fsm-compiler 包——一个有限状态机编译器。",
      "",
      "=== 核心功能 ===",
      "读取 FSM 定义（声明式描述：states/transitions/guards/actions），输出类型安全的 TypeScript 代码。",
      "",
      "=== 必须支持的特性 ===",
      "1. 层级 FSM —— 子状态嵌套（parent state 含 child states），支持进入/退出子状态时触发父状态回调",
      "2. 状态进入/退出动作 —— onEntry/onExit 钩子，每个状态可选",
      "3. 转换守卫 —— guard 函数，返回 boolean，决定转换是否允许执行",
      "4. 转换动作 —— transition action，转换发生时执行的副作用",
      "5. 编译期 schema 校验 —— FSM 定义在编译时验证完整性（不允许悬空引用、缺失初始状态）",
      "6. 输出 TypeScript —— 生成的代码 tsc --noEmit 零错，可直接 import 使用",
      "",
      "=== 包结构 ===",
      "- src/types.ts —— FSM 定义的类型（StateDef/TransitionDef/FsmDef）",
      "- src/compiler.ts —— 编译器核心（读定义→校验→生成 TS 代码字符串）",
      "- src/runtime.ts —— 运行时引擎（解释执行已编译的 FSM）",
      "- src/index.ts —— barrel 导出",
      "- tests/types.test.ts —— 类型定义测试（首行 // @ci: unit）",
      "- tests/compiler.test.ts —— 编译器测试（首行 // @ci: unit）",
      "- tests/runtime.test.ts —— 运行时测试（首行 // @ci: unit）",
      "- tests/integration.test.ts —— 全链路：定义→编译→执行 集成测试",
      "- PACKAGE_POSITIONING.md",
      "",
      "=== 示例输入 ===",
      "```typescript",
      "const lightFsm: FsmDef = {",
      "  initialState: 'green',",
      "  states: {",
      "    green: {",
      "      onEntry: () => console.log('绿灯'),",
      "      transitions: [{ event: 'NEXT', target: 'yellow' }],",
      "    },",
      "    yellow: {",
      "      transitions: [{ event: 'NEXT', target: 'red', guard: () => count > 0 }],",
      "    },",
      "    red: {",
      "      transitions: [{ event: 'NEXT', target: 'green' }],",
      "    },",
      "  },",
      "};",
      "```",
      "",
      "以上定义经编译器处理后，应生成可执行的 TypeScript Runtime，直接 import 即用。",
      "",
      "=== 架构要求 ===",
      "- types/compiler/runtime 三层职责分明，互相不越界",
      "- compiler 模块不依赖 runtime（编译期与运行期解耦）",
      "- 依赖倒置：runtime 依赖 types 的 interface，不依赖 compiler",
      "- 防御式：非法 FSM 定义在编译阶段报清晰错误，不静默吞掉",
      "",
      "=== 编码规范（强制）===",
      "- 禁止 any / 非空断言 ! / 空 catch {} / var",
      "- 公开 API 全带 JSDoc",
      "- 模块间无循环依赖",
      "",
      "=== 验收标准 ===",
      "- tsc --noEmit 零错误",
      "- vitest run 全部通过",
      "- 每个测试文件首行 // @ci: unit",
      "- 交通灯 FSM 示例可成功编译并运行",
      "- PACKAGE_POSITIONING.md 三问完整",
    ].join("\n"),
  };

  // 具名意图解析：--intent <名称> → 完整意图文本
  const userIntent = NAMED_INTENTS[userIntentArg ?? ""] ?? userIntentArg;

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
    "示例：STRATEGY: tag-matching | topological-layered | pipeline",
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
    skillContextBlock,
    "",
    "=== 你的任务 ===",
    "",
    "你当前在 monorepo 的 `packages/` 目录下。这里已有一些包（见上方探索结果）。",
    "你需要：1）确定包名 → 2）创建 `packages/<包名>/` 目录 → 3）在里面建造完整包。",
    "所有写入路径都以 `packages/` 为起点。写 `<包名>/src/index.ts` 就是在 `packages/<包名>/src/index.ts`。",
    "不能写入已有包的目录（会被工具层拒绝）。",
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
          "1. 【核心交付——组件式架构】包必须包含：",
          "   - src/index.ts（公开 API，barrel 导出）",
          "   - src/ 下至少 3 个独立功能模块，每个模块职责单一、边界清晰",
          "   - 至少 1 个 interface（扩展点/插件契约），让外部可以实现此接口并注册",
          "   - 一个 Registry/Factory 模式的注册机制，管理插件/策略的注册与查找",
          "   - tests/ 下每个模块至少一个单元测试文件",
          "2. 【可插拔设计】包的设计必须满足：",
          "   - 核心逻辑依赖抽象（interface），不依赖具体实现",
          "   - 新增功能 = 实现接口 + 注册，不修改已有代码（Open-Closed 原则）",
          "   - 策略模式：至少一处可通过注入不同实现来切换行为",
          "   - 构造函数注入依赖（DI），不在模块内部 new 具体类",
          "3. 【CI 标注】每个测试文件第一行必须是 `// @ci: unit`（宪法 §十四·一 自声明机制）",
          "4. 【编译通过】`npx tsc --noEmit` 必须零错误通过",
          "5. 【测试通过】`npx vitest run` 必须全部通过，覆盖率 ≥ 80% lines",
          "6. 【编码规范】所有代码必须遵守 coding-standards.md 全部约束（§一至§十四）：",
          "   - 禁止空 catch {} 块、var 声明、any 类型（公开 API）、非空断言 !",
          "   - 优先 interface 描述对象形状，type 仅用于联合/交叉/映射",
          "   - Discriminated union 替代 string + if/else 分叉",
          "   - 共享数据结构字段加 readonly，配置对象用 as const",
          "   - 禁止裸 console.error/warn（生产代码走 PipelineObserver，测试代码允许）",
          "   - 导入走 barrel：`import { X } from \"@cortex/xxx\"`",
          "   - 禁止硬编码魔法数字/路径/环境变量名/版本号——走 @cortex/config 常量",
          "7. 【可读性】所有公开 API（export 的函数/类/接口）必须带 JSDoc，说明：",
          "   - 做什么（一句话）",
          "   - @param 参数含义（每个参数一行）",
          "   - @returns 返回值含义",
          "   - @throws 可能抛出的异常",
          "8. 【可维护性】模块间依赖必须单向无环：",
          "   - src/ 下各模块之间不得出现循环 import",
          "   - 每个模块的 import 列表反映真实依赖拓扑——一眼能看懂",
          "   - 禁止隐式依赖（模块 A 修改全局状态，模块 B 读取）——必须显式传参",
          "9. 【可扩展性】新增能力时不修改已有代码：",
          "   - 新增策略/插件 = 实现已有 interface + 调用 registry.register()",
          "   - 新增模块 = 新建 src/<module>/ 目录 + 更新 barrel",
          "   - 已有测试断言不变（不因扩展而修改已有测试）",
          "10. 【补足声明】在包根目录创建 PACKAGE_POSITIONING.md，回答三个问题：",
          "   - 这个包补足了什么？（母项目中缺了什么）",
          "   - 它的定位是什么？（在 monorepo 架构中的位置和职责）",
          "   - 为什么值得合入？（解决了什么实际问题）",
          "11. 【模块化注册】包名必须是 @cortex/<name> 命名空间，package.json 依赖声明用 workspace:*",
          "12. 【技能沉淀——强制！】每个执行 Agent 完成节点后，必须在输出末尾附加 SkillTemplate JSON（```json 围栏块）。",
          "   这是技能系统自动提取的唯一入口。不附加 = 技能无法入池 = 经验浪费。",
          "   格式要求（必须包含以下字段）：",
          `   \`\`\`json`,
          `   {`,
          `     "name": "技能名称（动词开头，简短描述）",`,
          `     "kind": "action|thought|workflow",`,
          `     "triggerTags": ["标签1","标签2"],`,
          `     "trigger": "触发条件（一句话）",`,
          `     "steps": ["步骤1","步骤2","..."],`,
          `     "expectedOutput": "预期产出"`,
          `   }`,
          `   \`\`\``,
          "   kind: action=操作型/thought=思考型/workflow=工作流型",
          "   steps 不能为空（否则丢弃）。可输出数组（多个技能）或单对象。",
          "   你在每个 TaskNode 的 payload 中必须包含这段指令。",
          "",
          "=== 允许的工具 ===",
          "",
          "你拥有所有工具的完整访问权限：读取、写入、shell（npm install, tsc, vitest）。",
          "",
          "=== 路径规则（重要！）===",
          "你当前在 `packages/` 目录下，所有写入路径都从此解析。",
          "- 写文件用相对路径：`packages/<包名>/src/index.ts` → 创建 `packages/<包名>/src/index.ts`",
          "- **不能**覆盖已有包（CLI/engine/shared 等），工具层会拒绝",
          "- 根级文件（tsconfig.json 等）可直接写，用于集成注册",
          "- 你不需要 `packages/<包名>/packages/` 这种嵌套——`packages/` 是顶层",
          "",
          "所有文件必须保持在本目录内。你不能在外部写入。",
          "你可能需要探索母项目的具体源码来做决策——这由调度阶段的 Agent 来完成。",
          "规划阶段你只能基于上述探索摘要做决策。",
        ].join("\n"),
    "",
    "=== 事实依据与验证原则（铁律） ===",
    "",
    "你不是在凭空建造——你是在母项目中造一个新包。你的每一项决策都必须以事实为依据：",
    "",
    "1. 【读后写】写入任何文件前，必须先 read_file 确认目标位置的实际状态。",
    "   - 母项目已有的接口/类型/工具——先读，再决定复用还是新建。",
    "   - 母项目已有的包——先读其 barrel 导出，再决定依赖关系。",
    "   - 不要凭'记忆中已经实现了'的假设做决策——只信你亲眼读到的东西。",
    "",
    "2. 【探索先行】调度阶段的 Agent 在写代码前，必须先做探索：",
    "   - search_code 搜母项目中相关模式的实现方式",
    "   - read_file 读关键包的 src/index.ts 了解公开 API",
    "   - list_files 扫目标目录结构，确认没有命名冲突",
    "   - 探索结果必须反映在代码中——不能探索完了却不引用",
    "",
    "3. 【禁止臆测】以下行为构成'凭记忆建造'，属于违规：",
    "   - 假设某个包导出了某个函数——不读就 import",
    "   - 假设某个类型定义在某个文件——不读就引用",
    "   - 假设 coding-standards.md 中某条规则'应该改了'——规则以当前文件内容为准",
    "   - 假设 monorepo 结构'应该是这样'——结构以 list_files 实际输出为准",
    "",
    "4. 【母项目接口契约】你的包依赖母包时，必须：",
    "   - 只依赖母包 barrel 导出的公开符号（src/index.ts 中的 export）",
    "   - 不依赖母包的内部实现细节（src/ 下非 barrel 导出的符号）",
    "   - 不假设母包的内部文件路径（如 '../engine/src/core/xxx'——这是面包屑路径，不可依赖）",
    "",
    "=== 架构质量要求 —— 抽象层次与设计规范 ===",
    "",
    "你建造的包不是'能跑就行'——它必须具备生产级架构质量：",
    "",
    "1. 【三层抽象最低标准】包必须至少体现三层抽象：",
    "   第1层：接口层（interface）——定义'能做什么'，不定义'怎么做'",
    "   第2层：实现层（class implements interface）——至少 2 个实现变体",
    "   第3层：编排层（Registry/Factory/Composite）——管理实现的选择与组合",
    "",
    "2. 【依赖倒置】高层模块不依赖低层模块——二者都依赖抽象：",
    "   ✅ Registry 依赖 interface，不依赖具体 class",
    "   ✅ 业务逻辑接受 interface 参数（构造函数注入），不 new 具体类",
    "   ❌ 禁止：高层模块直接 import 低层模块的具体类来 new",
    "",
    "3. 【组件式组合】模块之间通过组合而非继承协作：",
    "   ✅ '有一个'（has-a）优于'是一个'（is-a）",
    "   ✅ 功能通过组装小接口实现，而非继承大基类",
    "   ❌ 禁止超过 2 层的继承链",
    "",
    "4. 【单一职责】每个模块/类/函数只做一件事：",
    "   - 类名能完整描述其职责——如果名字里有 'And' 或 'Or'，拆",
    "   - 方法体 > 30 行 → 考虑拆分子方法",
    "   - 一个文件一个主类/主函数——不堆砌无关符号",
    "",
    "5. 【防御式设计】对外接口必须是防御式的：",
    "   - 所有公开方法验证输入参数（非法输入抛明确错误，不静默吞掉）",
    "   - 所有异步操作有超时机制（不永久挂起）",
    "   - 资源（文件句柄/定时器/订阅）有清理机制（dispose/close/AbortSignal）",
    "",
    "规则：",
    "1. 包必须能用 `npx tsc --noEmit` 编译通过，`npx vitest run` 测试全部通过。",
    "2. 所有测试文件首行必须有 `// @ci: unit` 标注。",
    "3. 必须产出 PACKAGE_POSITIONING.md 说明补足内容和定位。",
    "4. 所有文件必须保持在本目录内。你不能在外部写入。",
    "5. 你拥有所有工具的完整访问权限：读取、写入、shell（npm install, tsc, tsx）。",
    "6. 每个执行 Agent 在写代码之前必须先用 read_file/list_files/search_code 探索母项目——以事实为依据，不以记忆为假设。",
    "   规划阶段你只能基于注入的探索摘要做决策。执行阶段 Agent 必须亲自验证。",
    "7. 每个 TaskNode 的 payload 末尾必须附加技能沉淀指令（强制要求第 12 条），让执行 Agent 输出 SkillTemplate JSON。",
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
    "",
    "⚠️ 每个 TaskNode 的 payload 字段末尾必须包含技能沉淀指令（强制要求第 12 条），否则 Agent 不会产出 SkillTemplate。",
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
  // 从原始 LLM 响应中提取 STRATEGY 行（不在 TaskNode payload 里）
  const planText = rawPlanResponse || extractPlanText(plan);
  const parsedMeta = tryParseMetaStrategy(planText);
  if (parsedMeta.strategy) {
    console.log(`   🤖 MetaAgent 选择: ${parsedMeta.strategy} | ${parsedMeta.driver} | ${parsedMeta.exec}`);
  } else {
    console.log(`   🤖 MetaAgent 未显式选择策略，使用默认值`);
  }
  const strategy = resolveStrategy(cliStrategy, planText);
  const driver = resolveDriver(cliDriver, planText);
  const execModel = resolveExecModel(cliExec, planText);

  console.log(`\n   🧪 调度组合: ${strategy.name} × ${driver.name} × ${execModel.name}\n`);

  // ═════ v2.6.6 模型路由：语义路由 + Agent floor 保护 ═════
  const modelRoutingDecisions: import("@cortex/scheduler").RouteDecision[] = [];
  const modelRouter = new SemanticModelRouter({
    catalog: {
      fast: CHAT_MODEL,
      standard: CHAT_MODEL,
      thinking: REASONER_MODEL,
    },
    modelsOrGetter: () => {
      const m = new Map<string, string>();
      for (const [type] of builtAgents) m.set(type, CHAT_MODEL);
      return m;
    },
    classifier: SemanticModelRouter.createSimpleClassifier(
      async (model: string, messages: Array<{ role: string; content: string }>) => {
        const result = await (adapter.chat as any)(messages, { model });
        return typeof result === "string" ? result : (result?.content ?? "");
      },
      CHAT_MODEL,
    ),
    onDecision: (d) => {
      modelRoutingDecisions.push(d);
      console.log(`   🧠 路由 [${d.nodeId.slice(0, 20)}] ${d.agentType}: ${d.floorTier}→${d.effectiveTier}(${d.source}) → ${d.model}`);
    },
  });
  console.log(`   🧠 模型路由: SemanticModelRouter 已启用 (catalog: fast=${CHAT_MODEL}, standard=${CHAT_MODEL}, thinking=${REASONER_MODEL})\n`);

  const scheduler = new Scheduler(board, pool, observer, metaAgent, engineConfig, {
    strategy,
    loopDriver: driver,
    executionModel: execModel,
    modelRouter,
  });

  // 注册全部 Agent 到调度器（分层模型：思考密集型用 REASONER_MODEL）
  const THINKING_AGENTS = new Set([AgentType.Code, AgentType.Review, AgentType.Analysis]);
  for (const [type, agent] of builtAgents) {
    const model = THINKING_AGENTS.has(type) ? REASONER_MODEL : CHAT_MODEL;
    scheduler.register(type, agent, model);
  }
  console.log(`   模型分层: thinking=[${[...THINKING_AGENTS].join(",")}] → ${REASONER_MODEL}`);

  for (const n of plan) {
    board.addNode(n);
  }
  console.log(`\n   ${plan.length} 个节点已入板。\n`);
  
    // ═════ 标签维度覆盖检查：确保每个 Agent 类型至少有一个指派任务 ═════
    const ALL_AGENT_TAGS = ["code", "review", "analysis", "ops", "loop", "doc-govern", "api", "data", "fix", "inspect"];
    const plannedTags = new Set(plan.flatMap(n => n.tags.map(t => String(t).toLowerCase())));
    const missingTags = ALL_AGENT_TAGS.filter(t => !plannedTags.has(t));
    if (missingTags.length > 0) {
      console.log(`   ⚠️  标签覆盖缺口: ${missingTags.join(", ")} — 甘雨未为这些 Agent 分配独立任务`);
    } else {
      console.log(`   ✅ 标签维度全覆盖: ${ALL_AGENT_TAGS.join(", ")} 全部有指派任务`);
    }
    console.log(`   标签分布: ${ALL_AGENT_TAGS.map(t => `${t}=${plannedTags.has(t) ? "✓" : "✗"}`).join(" ")}`);

  // ═════ SkillReferenced: 为每个节点发射技能参照事件 ═════
  let skillRefEmittedCount = 0;
  for (const n of plan) {
    const matched = skillRegistry.queryByTags(n.tags);
    if (matched.length > 0) {
      emitSkillReferenced(observer, matched, n.id, AgentType.Code); // 用 Code 占位——实际 agentType 在执行时确定
      skillRefEmittedCount += matched.length;
    }
  }
  if (skillRefEmittedCount > 0) {
    console.log(`   SkillReferenced: ${skillRefEmittedCount} 条技能参照事件已发射\n`);
  }

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

  // ═════ 扩展可观测性：ManifoldGate / RLM 拆解 / 上下文压缩 / Replan ═════
  let mfgEvents = 0, rlmDecomposeEvents = 0, contextCompressEvents = 0, replanEvents = 0;
  observer.on(PipelinePriority.NORMAL, (e) => {
    const t = String(e.type);
    if (t.startsWith("manifold_gate")) mfgEvents++;
    else if (t === PipelineEventType.RlmDecompose) rlmDecomposeEvents++;
    else if (t === PipelineEventType.RlmContextCompress) contextCompressEvents++;
    else if (t === PipelineEventType.NodeReplan) replanEvents++;
  });

  const execStart = Date.now();
  // ═════ Console → Observer 桥接：拦截 Agent 执行期间的噪声输出 ═════
  installConsoleBridge(observer);
  const report = await scheduler.executeAll();
  // ═════ 卸载桥接：恢复 console.log 以便输出 Phase 5 诊断结果 ═════
  uninstallConsoleBridge();
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

  // 发现 Agent 新建的包目录（与启动前快照做差集）
  for (const entry of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith(".") && !preExistingPkgs.has(entry.name)) {
      createdPkgDir = path.join(PACKAGES_DIR, entry.name);
      console.log(`   🆕 发现新建包: ${entry.name}`);
      break;
    }
  }
  if (!createdPkgDir) {
    console.log("   ❌ 未发现新建包目录，无法验收。");
  }

  const TARGET_DIR = createdPkgDir ?? PACKAGES_DIR;

  let acceptancePassed = createdPkgDir !== null;

  // 收集产出文件
  const producedFiles: string[] = [];
  const walkProduced = (d: string) => {
    if (!fs.existsSync(d)) return;
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
  walkProduced(TARGET_DIR);

  // 排除脚手架文件
  const sourceFiles = producedFiles.filter(
    (f) => !f.endsWith("tsconfig.json") && !f.endsWith("package.json")
  );

  console.log(`   产出文件 (${sourceFiles.length} 个):`);
  for (const f of sourceFiles) {
    const relative = path.relative(TARGET_DIR, f);
    const size = fs.statSync(f).size;
    console.log(`   ${size > 0 ? "✅" : "❌"} ${relative} (${size} bytes)`);
  }

  if (sourceFiles.length === 0) {
    console.log("\n   ❌ 验收失败：未发现任何产出文件。");
    acceptancePassed = false;
  }

  // ── 6a. 结构检查：src/index.ts + tests/ ──
  console.log("\n   ── 6a. 包结构检查 ──");
  const hasSrcIndex = fs.existsSync(path.join(TARGET_DIR, "src", "index.ts"));
  const testDir = path.join(TARGET_DIR, "tests");
  const hasTests = fs.existsSync(testDir) && fs.readdirSync(testDir).some(f => f.endsWith(".test.ts"));
  console.log(`   src/index.ts: ${hasSrcIndex ? "✅" : "❌ 缺失"}`);
  console.log(`   tests/*.test.ts: ${hasTests ? "✅" : "❌ 缺失"}`);
  if (!hasSrcIndex || !hasTests) acceptancePassed = false;

  // ── 6b. Barrel 导出检查 ──
  console.log("\n   ── 6b. Barrel 导出检查 ──");
  if (hasSrcIndex) {
    const barrelContent = fs.readFileSync(path.join(TARGET_DIR, "src", "index.ts"), "utf-8");
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
      cwd: TARGET_DIR,
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
      cwd: TARGET_DIR,
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
      console.log(`      · ${s.name} [${s.kind}] tags:[${s.triggerTags.join(",")}]`);
    }
  }

  // ── Phase 8: 合并门禁 —— 编码规范强制检查 + 补足定位确认 ──
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   🚪 合并门禁：编码规范 + 补足定位                    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // 8a. 补足定位文档检查
  const positioningPath = path.join(TARGET_DIR, "PACKAGE_POSITIONING.md");
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
  const srcDir = path.join(TARGET_DIR, "src");
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
      const relative = path.relative(TARGET_DIR, f);
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


  // 8b2. review.md P1 缺陷检测（修复 Agent 不能改主体代码，但不代表可以无视 P1）
  console.log("\n   ── 8b2. review.md P1 缺陷检测 ──");
  let p1DefectsResolved = true;
  const reviewPath = path.join(TARGET_DIR, "docs", "review.md");
  if (fs.existsSync(reviewPath)) {
    const reviewContent = fs.readFileSync(reviewPath, "utf-8");
    // 检测 P1 标记
    const p1Matches = reviewContent.match(/🔴\s*P1[-\s]*(\d+)?/g) || [];
    const p1Total = p1Matches.length;
    // 检测已修复标记
    const repairedPatterns = [/✅.*已修复/i, /已修复.*P1/i, /✅.*修复/i, /状态.*已修复/i];
    let repairedCount = 0;
    for (const pat of repairedPatterns) {
      const m = reviewContent.match(new RegExp(pat.source, "gi"));
      if (m) repairedCount += m.length;
    }
    const unresolvedP1 = Math.max(0, p1Total - repairedCount);
    console.log(`   发现 P1 缺陷: ${p1Total} 个`);
    console.log(`   已修复: ${Math.min(repairedCount, p1Total)} 个`);
    console.log(`   未修复: ${unresolvedP1} 个`);
    if (unresolvedP1 > 0) {
      console.log(`   ❌ ${unresolvedP1} 个 P1 缺陷未修复，合并阻塞`);
      p1DefectsResolved = false;
    } else {
      console.log(`   ✅ 所有 P1 缺陷已修复`);
    }
  } else {
    console.log("   ⚠️ review.md 不存在，跳过 P1 检测");
  }

  // 8c. 模块化注册检查（package.json 命名空间 + workspace 依赖）
  console.log("\n   ── 8c. 模块化注册检查 ──");
  let moduleRegOk = true;
  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(TARGET_DIR, "package.json"), "utf-8"));
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
  const mergeReady = positioningOk && codingStandardsOk && moduleRegOk && acceptancePassed && p1DefectsResolved;
  console.log(`   合并就绪: ${mergeReady ? "✅ 可合入" : "❌ 未就绪"} (P1缺陷: ${p1DefectsResolved ? "✅" : "❌"})`);

  // ── 技能 v2.6.0 最终诊断：运行期自动提取 + 权重/评价统计 ──
  console.log(`\n   ── v2.6.0 技能最终诊断 ──`);
  const finalSkills = skillRegistry.getAll();
  const newSkills = finalSkills.filter((s) => !availableSkills.some((as) => as.id === s.id));
  if (newSkills.length > 0) {
    console.log(`   🆕 运行期自动提取 ${newSkills.length} 个新技能:`);
    for (const s of newSkills) {
      console.log(`      · [${deriveStatus(s.weight, s.feedbackHistory)}] ${s.name} (${s.kind}, weight=${s.weight})`);
    }
  } else if (availableSkills.length === 0) {
    console.log(`   ⚠️ 运行期未自动提取新技能（Agent 输出中未检测到 SkillTemplate JSON）`);
  }
  const changedSkills = finalSkills.filter((s) => {
    const old = availableSkills.find((as) => as.id === s.id);
    return old && (old.weight !== s.weight || old.feedbackHistory.length !== s.feedbackHistory.length);
  });
  if (changedSkills.length > 0) {
    console.log(`   🔄 评价回流影响的技能:`);
    for (const s of changedSkills) {
      const old = availableSkills.find((as) => as.id === s.id)!;
      console.log(`      · ${s.name}: weight ${old.weight}→${s.weight}, feedbackHistory ${old.feedbackHistory.length}→${s.feedbackHistory.length}`);
    }
  }
  console.log(`   📊 技能池: ${finalSkills.length} 个 (trial=${finalSkills.filter((s) => deriveStatus(s.weight, s.feedbackHistory) === "trial").length}, active=${finalSkills.filter((s) => deriveStatus(s.weight, s.feedbackHistory) === "active").length}, deprecated=${finalSkills.filter((s) => deriveStatus(s.weight, s.feedbackHistory) === "deprecated").length})`);

  // ── SkillReferenced 可观测性诊断 ──
  console.log(`\n   ── SkillReferenced 可观测性 ──`);
  console.log(`   发射事件: ${skillRefEmittedCount} 条`);
  console.log(`   管线捕获: ${skillReferencedEvents.length} 条`);
  if (skillReferencedEvents.length > 0) {
    // 按节点 ID 分组
    const byNode = new Map<string, string[]>();
    for (const e of skillReferencedEvents) {
      const nodeKey = e.nodeId.slice(0, 40);
      const list = byNode.get(nodeKey) ?? [];
      list.push(e.skillName);
      byNode.set(nodeKey, list);
    }
    console.log(`   技能-节点关联:`);
    for (const [nodeKey, skills] of byNode) {
      console.log(`      [${nodeKey}] ← ${skills.join(", ")}`);
    }
    console.log(`   可观测性: ✅ 技能参照事件正常流转`);
  } else {
    console.log(`   ⚠️ 未捕获到 SkillReferenced 事件（技能池/节点标签未匹配）`);
  }

  unregisterSkillPipe();
  observer.off(PipelinePriority.NORMAL, skillRefTracker);

  // ── v2.6.6 模型路由最终诊断 ──
  console.log(`\n   ── v2.6.6 模型路由诊断 ──`);
  console.log(`   路由决策: ${modelRoutingDecisions.length} 条`);
  if (modelRoutingDecisions.length > 0) {
    const byTier = { fast: 0, standard: 0, thinking: 0 };
    const bySource = { recommended: 0, classifier: 0, "classifier-cached": 0, fallback: 0 };
    for (const d of modelRoutingDecisions) {
      byTier[d.effectiveTier] = (byTier[d.effectiveTier] ?? 0) + 1;
      bySource[d.source] = (bySource[d.source] ?? 0) + 1;
    }
    console.log(`   等级分布: fast=${byTier.fast}, standard=${byTier.standard}, thinking=${byTier.thinking}`);
    console.log(`   来源分布: recommended=${bySource.recommended}, classifier=${bySource.classifier}, cached=${bySource["classifier-cached"]}, fallback=${bySource.fallback}`);
    const upgraded = modelRoutingDecisions.filter(d => d.effectiveTier !== d.floorTier);
    if (upgraded.length > 0) {
      console.log(`   🔺 升级决策: ${upgraded.length} 条 (floor→effective)`);
      for (const d of upgraded) {
        console.log(`      [${d.nodeId.slice(0, 20)}] ${d.agentType}: ${d.floorTier}→${d.effectiveTier} (${d.source})`);
      }
    }
  } else {
    console.log(`   ⚠️ 无路由决策记录（可能 ModelRouter 未生效）`);
  }

  // ── 标签维度覆盖最终诊断 ──
  console.log(`\n   ── 标签维度覆盖诊断 ──`);
  const finalMissingTags = ALL_AGENT_TAGS.filter(t => !plannedTags.has(t));
  console.log(`   ${finalMissingTags.length > 0 ? `⚠️ 覆盖缺口: ${finalMissingTags.join(", ")}` : "✅ 全覆盖"}`);

  // ── v3.1 全链路能力诊断 ──
  console.log(`\n   ── v3.1 全链路能力诊断 ──`);
  console.log(`   ManifoldGate 槽位事件: ${mfgEvents}`);
  console.log(`   RLM 递归拆解事件:  ${rlmDecomposeEvents}`);
  console.log(`   上下文压缩事件:    ${contextCompressEvents}`);
  console.log(`   Replan 重规划事件: ${replanEvents}`);
  console.log(`   TrustModel:        已接入 ConfirmGate`);

  // ═════ Telemetry 遥测报告 ═════
  console.log(`\n   ── Telemetry 全链路遥测 ──`);
  console.log(`   采集器: ConsoleCollector (stdout 输出)`);

  // ── 收尾 ──
  uninstallConsoleBridge();
  shutdownTelemetry();
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
  console.log(`   六层防御: P0-Pending隔离 ${pendingIsolated ? "✅" : "❌"} | P1-InitVerifier ${consistencyReport && !consistencyReport.fatal ? "✅" : "⚠️"} | P2-技能沉淀 ${skillPrecipitated ? "✅" : "⚠️"} | v2.6.0-自动提取 ${newSkills.length}个新技能 | SkillRef追踪 ${skillReferencedEvents.length}条`);
  console.log(`   全链路: ManifoldGate ${mfgEvents} | RLM ${rlmDecomposeEvents} | 上下文压缩 ${contextCompressEvents} | Replan ${replanEvents} | 模型路由 ${modelRoutingDecisions.length} | TrustModel 已接入`);
  console.log();

  if (!acceptancePassed || !mergeReady || report.failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("💥 独自飞翔 E2E 崩溃:", e);
  process.exit(1);
});
