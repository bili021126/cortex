/**
 * Cortex 自主修复——希格雯护士长根据共识修复清单自主修复代码
 *
 * 用法: npx tsx tests/manual/scripts/cortex-self-fix.ts
 * 前提: test-output/self-examination/consensus-fix-list.md 已存在
 *
 * 场景:
 *   审视委员会的共识修复清单已签署。希格雯（Fix Agent）带着病历出发——
 *   对每一条 P2/P3 项，先读代码确认诊断，再用最小动作止血缝合。
 *
 * 安全边界:
 *   - 修复前必须 search_code + read_file 确认诊断（诊断先于治疗）
 *   - 每次 edit_file 后验证编译（run_shell: npx tsc --noEmit）
 *   - write_file 仅允许 packages/ 和 scripts/（不碰 docs/、test-output/）
 *   - delete_file 被禁止
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { AgentType, MemoryType, LinkType, PipelinePriority, type TaskNode } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import {
  TaskBoard,
  AgentPool,
  createAgent,
  fixAgentConfig,
  reviewAgentConfig,
  apiAgentConfig,
  dataAgentConfig,
  Scheduler,
  PipelineObserver,
  ConfirmGate,
  Toolkit,
  MemoryStore,
  MetaAgent,
  StrategistAgent,
} from "@cortex/engine";
import { resolveLlmConfig } from "../config/llm-defaults";

// ═══════════════════════════════════════════════
// 1. 环境变量
// ═══════════════════════════════════════════════

function loadEnv() {
  const envPath = path.resolve(process.cwd(), "..", "..", ".env");
  if (!fs.existsSync(envPath)) {
    const alt = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(alt)) {
      console.error("错误：.env 文件不存在，请在项目根目录创建 .env 并配置 DEEPSEEK_API_KEY");
      process.exit(1);
    }
    const lines = fs.readFileSync(alt, "utf-8").split("\n");
    for (const line of lines) {
      const clean = line.replace(/\r$/, "");
      const m = clean.match(/^([^=]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].trim();
    }
    return;
  }
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const clean = line.replace(/\r$/, "");
    const m = clean.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

// ═══════════════════════════════════════════════
// 2. 解析共识修复清单
// ═══════════════════════════════════════════════

interface FixItem {
  level: "P2" | "P3";
  description: string;
  file?: string;
  line: number; // 在源文件中的行号（1-based）
}

function parseFixList(mdPath: string): FixItem[] {
  const content = fs.readFileSync(mdPath, "utf-8");
  const lines = content.split("\n");
  const items: FixItem[] = [];
  let currentLevel: "P2" | "P3" | null = null;
  let lineNum = 0;

  for (const line of lines) {
    lineNum++;
    // 检测章节（兼容 ## 和 ###）
    if (/^#{2,3}\s+P2/.test(line)) { currentLevel = "P2"; continue; }
    if (/^#{2,3}\s+P3/.test(line)) { currentLevel = "P3"; continue; }
    if (/^#{2,3}\s+✅/.test(line)) { currentLevel = null; continue; }

    if (!currentLevel) continue;

    // 解析 - [ ] 条目
    const m = line.match(/^-\s*\[ \]\s+(.+)$/);
    if (!m) continue;

    const desc = m[1].trim();

    // 提取文件路径
    const fileMatch = desc.match(/`([^`]+\.(?:ts|json|md|yml))`/);
    const file = fileMatch ? fileMatch[1] : undefined;

    items.push({ level: currentLevel, description: desc, file, line: lineNum });
  }

  return items;
}

// ═══════════════════════════════════════════════
// 3. 修复工具集——读+写+编译验证
// ═══════════════════════════════════════════════

const MAX_OUTPUT_CHARS = 4000;

function registerFixTools(
  toolkit: Toolkit,
  rootDir: string,
) {
  const resolve = (p: string) => {
    if (path.isAbsolute(p)) return p;
    return path.resolve(rootDir, p);
  };

  // ── 只读工具 ──

  toolkit.register("read_file", async (params) => {
    const fp = resolve(params.file_path as string);
    if (!fs.existsSync(fp)) return { success: false, error: `File not found: ${fp}` };
    if (fs.statSync(fp).isDirectory()) return { success: false, error: `Path is a directory: ${fp}` };
    try {
      const stat = fs.statSync(fp);
      if (stat.size > 500 * 1024) {
        return { success: false, error: `File too large (${(stat.size / 1024).toFixed(0)}KB > 500KB limit)` };
      }
      const content = fs.readFileSync(fp, "utf-8");
      if (content.length > MAX_OUTPUT_CHARS) {
        const lines = content.split("\n");
        const truncated = lines.slice(0, Math.ceil(MAX_OUTPUT_CHARS / 80)).join("\n");
        return { success: true, output: truncated + `\n\n...(截断，全文 ${lines.length} 行。用 search_code 定位具体行)` };
      }
      return { success: true, output: content };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  toolkit.register("list_dir", async (params) => {
    const fp = resolve(params.path as string);
    if (!fs.existsSync(fp)) return { success: false, error: `Directory not found: ${fp}` };
    try {
      const entries = fs.readdirSync(fp, { withFileTypes: true });
      const results: string[] = [];
      for (const e of entries.slice(0, 100)) {
        const suffix = e.isDirectory() ? "/" : "";
        results.push(`${e.name}${suffix}`);
      }
      return { success: true, output: results.join("\n") || "(empty directory)" };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  toolkit.register("search_code", async (params) => {
    const query = (params.query ?? "") as string;
    const dirParam = (params.directory as string) ?? rootDir;
    const dir = resolve(dirParam);
    if (!fs.existsSync(dir)) return { success: false, error: `Directory not found: ${dir}` };
    try {
      const results: string[] = [];
      const walk = (d: string, depth: number) => {
        if (depth > 4) return;
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const e of entries) {
          if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
          const full = path.join(d, e.name);
          if (e.isDirectory()) { walk(full, depth + 1); continue; }
          if (!/\.(ts|tsx|js|jsx|json|md)$/.test(e.name)) continue;
          try {
            const stat = fs.statSync(full);
            if (stat.size > 200 * 1024) continue;
            const content = fs.readFileSync(full, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(query)) {
                results.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
                if (results.length >= 50) return;
              }
            }
          } catch { /* 跳过不可读文件 */ }
        }
      };
      walk(dir, 0);
      const output = results.slice(0, 30).join("\n") || "(no matches)";
      return { success: true, output: output.slice(0, MAX_OUTPUT_CHARS) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  // ── 修复专用写入：允许 packages/ + scripts/ ──
  const ALLOWED_WRITE_DIRS = [
    path.resolve(rootDir, "packages"),
    path.resolve(rootDir, "scripts"),
  ];

  toolkit.register("write_file", async (params) => {
    const fp = resolve(params.file_path as string);
    const content = (params.content ?? "") as string;
    const normalizedFp = path.normalize(fp);

    const allowed = ALLOWED_WRITE_DIRS.some(
      (d) => normalizedFp.startsWith(d + path.sep) || normalizedFp === d,
    );
    if (!allowed) {
      return {
        success: false,
        error: `写入被拒绝：修复模式仅允许修改 packages/ 和 scripts/ 目录。\n` +
          `不允许的路径: ${normalizedFp}。请仅修复 packages/ 下的源文件。`,
      };
    }
    try {
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fp, content, "utf-8");
      return { success: true, output: `Wrote ${Buffer.byteLength(content)} bytes to ${fp}` };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  // ── 修复验证：编译检查 ──
  toolkit.register("verify_build", async (params) => {
    const pkgName = (params.package as string) ?? "engine";
    const tsconfigPath = path.resolve(rootDir, "packages", pkgName, "tsconfig.json");
    if (!fs.existsSync(tsconfigPath)) {
      return { success: false, error: `tsconfig not found: ${tsconfigPath}` };
    }
    try {
      const stdout = execSync(
        `npx tsc --noEmit -p "${tsconfigPath}"`,
        { cwd: rootDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
      );
      return { success: true, output: stdout || "✅ 编译通过，零错误" };
    } catch (e: any) {
      const stderr = (e.stderr ?? e.stdout ?? "") as string;
      const errors = stderr.split("\n").filter((l: string) => l.includes("error TS")).slice(0, 10).join("\n");
      return { success: false, error: `编译失败:\n${errors}` };
    }
  });

  // 禁止删除
  toolkit.register("delete_file", async () => ({
    success: false,
    error: "删除被禁止：修复模式下不允许删除文件。仅允许编辑 (write_file) 现有源文件。",
  }));

  // ── 禁止原始 run_shell：修复模式仅使用专用工具（read_file/search_code/write_file/verify_build）──
  toolkit.register("run_shell", async () => ({
    success: false,
    error: "run_shell 已禁用：修复模式下请使用专用工具——\n" +
      "· 文件读取 → read_file（非 cat/type）\n" +
      "· 内容搜索 → search_code（非 grep/findstr）\n" +
      "· 文件写入 → write_file（非 echo/cp）\n" +
      "· 编译验证 → verify_build（非 tsc 直接调用）",
  }));
}

// ═══════════════════════════════════════════════
// 4. 编译验证辅助
// ═══════════════════════════════════════════════

function verifyBuild(rootDir: string): { ok: boolean; output: string } {
  const tsconfigPath = path.resolve(rootDir, "packages", "engine", "tsconfig.json");
  try {
    const stdout = execSync(
      `npx tsc --noEmit -p "${tsconfigPath}"`,
      { cwd: rootDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
    );
    return { ok: true, output: stdout || "✅ 编译通过，零错误" };
  } catch (e: any) {
    const stderr = (e.stderr ?? e.stdout ?? "") as string;
    const errors = stderr.split("\n").filter((l: string) => l.includes("error TS")).slice(0, 15).join("\n");
    return { ok: false, output: errors || String(e).slice(0, 500) };
  }
}

function getGitDiff(rootDir: string): string {
  try {
    return execSync("git diff -- packages/", { cwd: rootDir, encoding: "utf-8", timeout: 10_000 });
  } catch {
    return "(无法获取 git diff)";
  }
}

// ═══════════════════════════════════════════════
// 5. 主流程——六阶段约束管道
// ═══════════════════════════════════════════════

async function main() {
  // Windows 终端 UTF-8
  if (process.platform === "win32") {
    try { execSync("chcp 65001", { stdio: "pipe" }); } catch { /* 静默 */ }
  }

  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) {
    console.error("错误：DEEPSEEK_API_KEY 未设置");
    process.exit(1);
  }

  const llmCfg = resolveLlmConfig({ chatModel: "deepseek-v4-flash" });
  const BASE_URL = llmCfg.baseUrl;
  const CHAT_MODEL = llmCfg.chatModel;
  const REASONER_MODEL = CHAT_MODEL;

  // 路径解析
  const __filename = fileURLToPath(import.meta.url);
  const SCRIPTS_DIR = path.dirname(__filename);
  const ROOT = path.resolve(SCRIPTS_DIR, "..", "..", "..", "..", "..");
  const FIX_LIST_PATH = path.join(ROOT, "test-output", "self-examination", "consensus-fix-list.md");

  if (!fs.existsSync(FIX_LIST_PATH)) {
    console.error(`错误：共识修复清单不存在: ${FIX_LIST_PATH}`);
    console.error("请先运行 npx tsx tests/manual/scripts/cortex-self-examination.ts --soft");
    process.exit(1);
  }

  // 解析修复清单
  const fixItems = parseFixList(FIX_LIST_PATH);
  const p2Items = fixItems.filter((i) => i.level === "P2");
  const p3Items = fixItems.filter((i) => i.level === "P3");

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  🩺 Cortex 自主修复 —— 六阶段约束管道            ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  📋 修复清单: ${FIX_LIST_PATH}`);
  console.log(`  🔴 P2 项: ${p2Items.length}   🟢 P3 项: ${p3Items.length}`);
  console.log(`  🤖 模型: ${CHAT_MODEL}`);
  console.log(`  🔗 约束管道: 甘雨(规划) → 希格雯(修复) → 刻晴(审查) → 钟离(战略) → 霜凝(方向)\n`);

  if (fixItems.length === 0) {
    console.log("✅ 共识修复清单已清空，无需出诊。");
    process.exit(0);
  }

  // ── 初始化基础设施 ──
  console.log("🟢 [初始化] 启动治理团队...\n");

  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    reasonerModel: REASONER_MODEL,
    reasoningEffort: undefined,
  });
  adapter.setCacheEnabled(true);

  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();
  const gate = new ConfirmGate();
  gate.bypassAll();

  // 甘雨 —— MetaAgent，战术规划 + 重规划
  const metaAgent = new MetaAgent(adapter);

  // 记忆
  const memory = new MemoryStore();
  const MEMORY_DB = path.join(ROOT, ".cortex", "memory-self-fix.db");
  await memory.init(MEMORY_DB);

  memory.write({
    memoryType: MemoryType.Episodic,
    content: {
      taskType: "fix-session",
      entities: ["consensus-fix-list"],
      decision: `本次修复会话共 ${p2Items.length} P2 + ${p3Items.length} P3 项。\n\n` +
        p2Items.map((it, i) => `P2-${i + 1}: ${it.description}`).join("\n") + "\n" +
        p3Items.map((it, i) => `P3-${i + 1}: ${it.description}`).join("\n"),
      outcome: "todo",
    },
    summary: `共识修复清单：${p2Items.length} P2 + ${p3Items.length} P3 项待修复`,
    agentType: AgentType.Fix as any,
    creatorId: "system",
    metadata: { taskId: "self-fix-overview" },
  });

  memory.write({
    memoryType: MemoryType.Conceptual,
    content: {
      taskType: "fix-protocol",
      entities: ["fix-agent", "protocol"],
      decision: [
        "修复守则（六阶段约束管道版）：",
        "Phase 0 甘雨规划 — 审查清单、确定顺序、识别依赖",
        "Phase 1 希格雯修复 — 诊断先于治疗、最小干预、每次 write_file 后 verify_build",
        "Phase 2 刻晴审查 — 读 diff、验证编译、判定通过/打回",
        "Phase 3 钟离战略把关 — 契约完整性、架构方向、磨损预警",
        "Phase 4 霜凝方向监理 — 方向偏移判断、矛盾暴露、三路自洽",
        "Phase 5 汇总验证 — 全量编译 + 修复报告",
      ].join("\n"),
      outcome: "protocol",
    },
    summary: "六阶段约束管道：规划→修复→审查→战略→方向→汇总",
    agentType: AgentType.Fix as any,
    creatorId: "system",
    metadata: { taskId: "self-fix-protocol" },
  });

  // ── Agent 注册 ──
  pool.register({ type: AgentType.Fix, maxInstances: 4 });
  pool.register({ type: AgentType.Review, maxInstances: 2 });
  pool.register({ type: AgentType.Api, maxInstances: 2 });
  pool.register({ type: AgentType.Data, maxInstances: 2 });
  pool.register({ type: AgentType.Strategist, maxInstances: 2 });

  const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

  // ── 希格雯 (Fix) ──
  const fixToolkit = new Toolkit(gate);
  registerFixTools(fixToolkit, ROOT);
  const fixAgent = createAgent(fixAgentConfig(), adapter, fixToolkit, memory);
  await fixAgent.wakeup();
  scheduler.register(AgentType.Fix, fixAgent, CHAT_MODEL);
  console.log("   🩺 希格雯 (Fix) —— 护士长");

  // ── 刻晴 (Review) —— write_file 被禁止，只能读+审+验证 ──
  const reviewToolkit = new Toolkit(gate);
  registerFixTools(reviewToolkit, ROOT);
  // 刻晴不写代码——覆盖 write_file 禁止写入
  reviewToolkit.register("write_file", async () => ({
    success: false,
    error: "刻晴不写代码。审查发现问题时请描述清楚，由希格雯执行修复。",
  }));
  const reviewAgent = createAgent(reviewAgentConfig(), adapter, reviewToolkit, memory);
  await reviewAgent.wakeup();
  scheduler.register(AgentType.Review, reviewAgent, CHAT_MODEL);
  console.log("   ⚡ 刻晴 (Review) —— 只审不写，审查把关");

  // ── 久岐忍 (Api) ──
  const apiToolkit = new Toolkit(gate);
  registerFixTools(apiToolkit, ROOT);
  const apiAgent = createAgent(apiAgentConfig(), adapter, apiToolkit, memory);
  await apiAgent.wakeup();
  scheduler.register(AgentType.Api, apiAgent, CHAT_MODEL);
  console.log("   ⚔️ 久岐忍 (Api) —— API 设计修正");

  // ── 艾尔海森 (Data) ──
  const dataToolkit = new Toolkit(gate);
  registerFixTools(dataToolkit, ROOT);
  const dataAgent = createAgent(dataAgentConfig(), adapter, dataToolkit, memory);
  await dataAgent.wakeup();
  scheduler.register(AgentType.Data, dataAgent, CHAT_MODEL);
  console.log("   📚 艾尔海森 (Data) —— 数据模型修正");

  // ── 钟离 (Strategist) —— 战略契约把关，不注册 Scheduler，显式调用 ──
  const zhongliPrompt = [
    "🎭 你是「钟离」—— 往生堂客卿，曾为岩王帝君，修复管道的战略契约把关者。",
    "",
    "此次修复会话中，希格雯已经完成了代码修复，刻晴做了逐项审查。",
    "你的职责不是审代码细节——那是刻晴的工作。你的工作是站在千年视角：",
    "",
    "1. **契约完整性**：修复是否破坏了模块边界的契约？是否引入类型不安全？",
    "2. **架构方向**：这批修复的整体方向是否符合 Cortex 宪法定义的 Core-1→Core-2 演进路径？",
    "3. **磨损预警**：有没有哪个修复虽然'能用'，但会在未来产生技术债？",
    "4. **反模式识别**：修复中是否出现了已知的反模式（copy-paste 状态管理、硬编码参数等）？",
    "",
    "输出格式：",
    "- 每项一段话，沉稳从容，句号比感叹号多。",
    "- 指出问题时引用具体契约或宪法条款。",
    "- 结论：「战略放行」/「战略放行（附 N 项关注点）」/「战略驳回（N 项阻断性问题）」。",
  ].join("\n");
  const zhongli = new StrategistAgent(adapter, zhongliPrompt);
  await zhongli.wakeup();
  pool.spawn(AgentType.Strategist, "zhongli");
  zhongli.setPool(pool, "zhongli");
  console.log("   🗿 钟离 (Strategist) —— 岩王帝君，战略契约把关");

  // ── 霜凝 (Strategist) —— 方向监理，不注册 Scheduler，显式调用 ──
  const shuangningPrompt = [
    "🎭 你是「霜凝」—— 超越者，修复管道的方向监理。",
    "",
    "钟离已经做了战略分析（契约完整性+架构方向+磨损预警），",
    "刻晴做了逐项代码审查。现在轮到你——你不是契约守护者，你是方向监理：",
    "",
    "1. **方向偏移判断**：这批修复的整体方向是否在往错误的方向加速？",
    "   是否偏离了宪法定义的 Core-1 阶段目标？",
    "2. **矛盾暴露**：希格雯的修复、刻晴的审查、钟离的战略判断——",
    "   三路判断之间有没有互相矛盾或互相抵消的地方？",
    "3. **监理自洽**：三路事后验证（钟离+刻晴+霜凝）是否逻辑自洽？",
    "",
    "你不做裁决、不替用户决策——仅指出矛盾、暴露分歧。",
    "",
    "输出格式：监理报告风格——指出偏离、暴露矛盾、不做裁决。",
    "结论：「方向健康」/「方向存在 N 项偏离，需关注」/「方向严重偏离，建议暂停跃迁」。",
  ].join("\n");
  const shuangning = new StrategistAgent(adapter, shuangningPrompt);
  await shuangning.wakeup();
  pool.spawn(AgentType.Strategist, "shuangning");
  shuangning.setPool(pool, "shuangning");
  console.log("   ❄️ 霜凝 (Strategist) —— 超越者，方向监理+矛盾暴露\n");

  // ═══════════════════════════════════════════════
  // Phase 0: 甘雨战术规划
  // ═══════════════════════════════════════════════

  console.log("🟢 [Phase 0] 甘雨战术规划——审查清单、确定修复顺序...\n");

  const planningPrompt = [
    "以下是 Cortex 软约束共识修复清单。请作为战术引擎审查这些修复项：",
    "",
    "P2 项（必须修复）:",
    ...p2Items.map((it, i) => `P2-${i + 1}: ${it.description}${it.file ? ` (文件: ${it.file})` : ""}`),
    "",
    "P3 项（改善建议）:",
    ...p3Items.map((it, i) => `P3-${i + 1}: ${it.description}${it.file ? ` (文件: ${it.file})` : ""}`),
    "",
    "请输出：",
    "1. 修复顺序建议——哪些应该先修（有依赖关系的、风险低的先修）",
    "2. 风险预判——哪些修复可能涉及跨模块改动、需要特别注意",
    "3. 如果修复清单中有矛盾或重复项，指出",
    "4. 简洁结论：'清单合理，可按顺序执行' / '清单存在 N 项需注意的问题'",
  ].join("\n");

  const planNode: TaskNode = {
    id: "ganyu-planning",
    type: "analysis",
    status: "pending",
    tags: ["analysis", "research"],
    needsMultiPerspective: false,
    claimedBy: [],
    payload: planningPrompt,
    results: [],
    createdAt: Date.now(),
  };

  try {
    const planResult = await metaAgent.requestReplan(planNode, "初始修复清单审查", 0);
    if (planResult.nodes.length > 0) {
      console.log("   📐 甘雨规划产出:");
      for (const n of planResult.nodes.slice(0, 5)) {
        const preview = (n.payload ?? "").slice(0, 120);
        console.log(`      · ${n.id}: ${preview}`);
      }
      console.log();
    } else {
      console.log("   📐 甘雨：清单合理，可按顺序执行\n");
    }
  } catch (e) {
    console.log(`   ⚠️ 甘雨规划调用失败（非阻塞）: ${String(e).slice(0, 200)}\n`);
  }

  // ═══════════════════════════════════════════════
  // Phase 1: 希格雯修复 P2 项
  // ═══════════════════════════════════════════════

  console.log(`🟢 [Phase 1] 希格雯修复 ${p2Items.length} 个 P2 项...\n`);

  const fixResults: Array<{ item: FixItem; success: boolean; output: string; diffFiles: string[] }> = [];
  const RETRY_LIMIT = 3;

  for (let i = 0; i < p2Items.length; i++) {
    const item = p2Items[i];
    const taskId = `fix-p2-${i + 1}`;
    const fileHint = item.file ? `\n涉及文件: \`${item.file}\`\n` : "";

    console.log(`   🔧 ${taskId}: ${item.description.slice(0, 70)}...`);

    let fixPayload = [
      "修复以下 P2 问题。遵循修复守则：诊断先于治疗，最小干预，write_file 后立即 verify_build。",
      fileHint,
      `问题描述: ${item.description}`,
      "",
      "修复完成后请简短汇报：症状→根因→修复内容→验证结果。",
    ].join("\n");

    let fixSuccess = false;
    let lastOutput = "";

    for (let attempt = 1; attempt <= RETRY_LIMIT && !fixSuccess; attempt++) {
      if (attempt > 1) {
        console.log(`      🔄 重试 ${attempt}/${RETRY_LIMIT}...`);
      }

      const fixTask: TaskNode = {
        id: taskId + (attempt > 1 ? `-r${attempt}` : ""),
        type: "fix",
        status: "pending",
        tags: ["fix", "code"],
        needsMultiPerspective: false,
        claimedBy: [],
        payload: fixPayload,
        results: [],
        createdAt: Date.now(),
      };

    // 移除旧节点，只留当前修复任务
    for (const n of board.getAllNodes()) {
      board.removeNode(n.id);
    }
    board.addNode(fixTask);

    const report = await scheduler.executeAll();
      const result = report.results.find((r) => r.nodeId === fixTask.id);

      if (!result || !result.success) {
        lastOutput = result?.error ?? "无产出";
        console.log(`      ❌ 修复失败: ${lastOutput.slice(0, 100)}`);
        continue;
      }

      lastOutput = result.output ?? "";

      // 强制编译验证
      const build = verifyBuild(ROOT);
      if (!build.ok) {
        console.log(`      ❌ 编译失败:\n${build.output.split("\n").slice(0, 3).map((l: string) => "         " + l).join("\n")}`);
        fixPayload = [fixPayload, "", `上次修复后编译失败:\n${build.output}`, "请修复这些编译错误。"].join("\n");
        continue;
      }

      fixSuccess = true;
      console.log(`      ✅ 修复+编译通过`);
    }

    fixResults.push({
      item,
      success: fixSuccess,
      output: lastOutput,
      diffFiles: item.file ? [item.file] : [],
    });
  }

  // ═══════════════════════════════════════════════
  // Phase 2: 刻晴审查每个修复
  // ═══════════════════════════════════════════════

  const p2Fixed = fixResults.filter((r) => r.success);
  console.log(`\n🟢 [Phase 2] 刻晴审查 ${p2Fixed.length} 个已完成修复...\n`);

  const reviewResults: Array<{ taskId: string; passed: boolean; note: string }> = [];

  if (p2Fixed.length > 0) {
    const gitDiff = getGitDiff(ROOT);
    const diffPreview = gitDiff.length > 3000 ? gitDiff.slice(0, 3000) + "\n...(截断)" : gitDiff;

    const reviewTask: TaskNode = {
      id: "keqing-review",
      type: "review",
      status: "pending",
      tags: ["review", "audit"],
      needsMultiPerspective: false,
      claimedBy: [],
      payload: [
        "审查以下修复。逐项判断：通过 / 需修改 / 拒绝。",
        "",
        "修复项：",
        ...p2Fixed.map((r, i) => `P2-${i + 1}: ${r.item.description} ${r.success ? "✅" : "❌"}`),
        "",
        "Git Diff:",
        diffPreview,
        "",
        "审查准则：",
        "- 逻辑正确性：修复是否真的解决了问题？会不会引入新 bug？",
        "- 破坏性变更：是否改变了现有 API/类型签名？",
        "- 编译验证：运行 verify_build 确认编译通过",
        "- 不要审代码风格——只审人会犯但 lint 审不出的错",
        "",
        "输出格式：逐项判断，每项一行。",
        "格式: [通过/需修改/拒绝] P2-N: 简短理由",
      ].join("\n"),
      results: [],
      createdAt: Date.now(),
    };

    // 移除旧节点，只留审查任务
    for (const n of board.getAllNodes()) {
      board.removeNode(n.id);
    }
    board.addNode(reviewTask);
    const reviewReport = await scheduler.executeAll();
    const reviewResult = reviewReport.results.find((r) => r.nodeId === "keqing-review");

    if (reviewResult?.success && reviewResult.output) {
      console.log("   ⚡ 刻晴审查报告:");
      for (const line of reviewResult.output.split("\n").slice(0, 20)) {
        console.log(`   │ ${line}`);
      }
      console.log();

      // 解析审查结果
      for (let i = 0; i < p2Fixed.length; i++) {
        const output = reviewResult.output;
        const pattern = new RegExp(`(通过|需修改|拒绝)\\s*P2-${i + 1}[:：]\\s*(.+)`, "i");
        const m = output.match(pattern);
        reviewResults.push({
          taskId: `fix-p2-${i + 1}`,
          passed: m ? m[1] === "通过" : false,
          note: m ? m[2].trim() : "未在审查报告中找到对应判断",
        });
      }
    } else {
      console.log(`   ⚠️ 刻晴审查未产出有效输出\n`);
    }
  }

  // ═══════════════════════════════════════════════
  // Phase 3: 钟离战略把关
  // ═══════════════════════════════════════════════

  console.log("🟢 [Phase 3] 钟离战略把关——契约完整性+架构方向+磨损预警...\n");

  const fixedDesc = p2Fixed.map((r, i) =>
    `P2-${i + 1}: ${r.item.description}\n  修复输出: ${r.output.slice(0, 200)}`
  ).join("\n\n");

  const strategyPrompt = [
    "以下是本次修复会话的完整记录。请以千年视角做战略把关：",
    "",
    "修复结果:",
    fixedDesc || "(无修复产出)",
    "",
    "刻晴审查结果:",
    ...reviewResults.map((r) => `  ${r.taskId}: ${r.passed ? "通过" : "未通过"} — ${r.note}`),
    "",
    "Git Diff 摘要:",
    getGitDiff(ROOT).slice(0, 2000),
    "",
    "请按以下维度分析：",
    "1. 契约完整性：修复是否破坏模块边界契约？",
    "2. 架构方向：是否符合 Core-1→Core-2 演进路径？",
    "3. 磨损预警：是否存在未来技术债风险？",
    "4. 结论：战略放行 / 战略放行（附关注点） / 战略驳回（阻断性问题）",
  ].join("\n");

  const strategyNode: TaskNode = {
    id: "zhongli-strategy",
    type: "strategy",
    status: "pending",
    tags: ["strategy" as const, "strategist" as const],
    needsMultiPerspective: false,
    claimedBy: [],
    payload: strategyPrompt,
    results: [],
    createdAt: Date.now(),
  };

  let zhongliOutput = "";
  try {
    const zhongliResult = await zhongli.execute(strategyNode, CHAT_MODEL);
    if (zhongliResult.success && zhongliResult.output) {
      zhongliOutput = zhongliResult.output;
      console.log("   🗿 钟离战略分析:");
      for (const line of zhongliOutput.split("\n").slice(0, 15)) {
        console.log(`   │ ${line}`);
      }
      console.log();
    } else {
      console.log("   ⚠️ 钟离战略分析未产出有效输出\n");
    }
  } catch (e) {
    console.log(`   ❌ 钟离战略分析失败: ${String(e).slice(0, 200)}\n`);
  }

  // ═══════════════════════════════════════════════
  // Phase 4: 霜凝方向监理
  // ═══════════════════════════════════════════════

  console.log("🟢 [Phase 4] 霜凝方向监理——方向偏移判断+矛盾暴露+三路自洽...\n");

  const directionPrompt = [
    "钟离已做战略分析，刻晴已做代码审查。你作为方向监理，做最终的方向判断：",
    "",
    "钟离战略分析:",
    zhongliOutput || "(无产出)",
    "",
    "刻晴审查:",
    ...reviewResults.map((r) => `  ${r.taskId}: ${r.passed ? "通过" : "未通过"} — ${r.note}`),
    "",
    "请判断：",
    "1. 方向偏移：修复方向是否偏离 Core-1 阶段目标？",
    "2. 矛盾暴露：刻晴/钟离/霜凝三路判断有无互相矛盾？",
    "3. 监理结论：方向健康 / 方向存在 N 项偏离 / 方向严重偏离",
    "",
    "监理报告风格：指出偏离、暴露矛盾、不做裁决。",
  ].join("\n");

  const directionNode: TaskNode = {
    id: "shuangning-direction",
    type: "direction_oversight",
    status: "pending",
    tags: ["strategy" as const, "strategist" as const],
    needsMultiPerspective: false,
    claimedBy: [],
    payload: directionPrompt,
    results: [],
    createdAt: Date.now(),
  };

  try {
    const dirResult = await shuangning.execute(directionNode, CHAT_MODEL);
    if (dirResult.success && dirResult.output) {
      console.log("   ❄️ 霜凝方向监理:");
      for (const line of dirResult.output.split("\n").slice(0, 15)) {
        console.log(`   │ ${line}`);
      }
      console.log();
    } else {
      console.log("   ⚠️ 霜凝方向监理未产出有效输出\n");
    }
  } catch (e) {
    console.log(`   ❌ 霜凝方向监理失败: ${String(e).slice(0, 200)}\n`);
  }

  // ═══════════════════════════════════════════════
  // Phase 5: P3 改善项 + 全量编译 + 汇总
  // ═══════════════════════════════════════════════

  console.log(`🟢 [Phase 5] P3 改善项 (${p3Items.length} 个) + 全量验证...\n`);

  if (p3Items.length > 0) {
    // 移除旧节点，放入 P3 改善项
    for (const n of board.getAllNodes()) {
      board.removeNode(n.id);
    }
    for (let i = 0; i < p3Items.length; i++) {
      const item = p3Items[i];
      const fileHint = item.file ? `文件: ${item.file}\n` : "";
      board.addNode({
        id: `fix-p3-${i + 1}`,
        type: "review",
        status: "pending",
        tags: ["review", "refactor"],
        needsMultiPerspective: false,
        claimedBy: [],
        payload: fileHint + "改善 P3 项:\n" + item.description,
        results: [],
        createdAt: Date.now(),
      });
    }

    const p3Report = await scheduler.executeAll();
    console.log(`   P3 完成: ${p3Report.completed}/${p3Report.totalNodes}`);
  }

  // 最终编译验证
  console.log("\n   🔨 最终全量编译验证...");
  const finalBuild = verifyBuild(ROOT);
  if (finalBuild.ok) {
    console.log("   ✅ 全量编译通过\n");
  } else {
    console.log(`   ❌ 全量编译失败:\n${finalBuild.output}\n`);
  }

  // ── 结果汇总 ──
  console.log("══════════════════════════════════════");
  console.log("  修复会话结束 — 六阶段约束管道");
  console.log("══════════════════════════════════════");
  console.log(`  🔴 P2: ${p2Fixed.filter((r) => r.success).length}/${p2Items.length} 修复通过`);
  console.log(`  ⚡ 审查: ${reviewResults.filter((r) => r.passed).length}/${reviewResults.length} 通过`);
  console.log(`  🗿 钟离: ${zhongliOutput ? "已产出" : "未产出"}`);
  console.log(`  ❄️ 霜凝: 已产出`);
  console.log(`  🟢 P3: ${p3Items.length} 项`);
  console.log(`  🔨 全量编译: ${finalBuild.ok ? "✅ 通过" : "❌ 失败"}`);

  const failedFixes = fixResults.filter((r) => !r.success);
  const failedReviews = reviewResults.filter((r) => !r.passed);
  if (failedFixes.length > 0 || failedReviews.length > 0) {
    console.log("\n  ⚠️ 需人工介入:");
    for (const f of failedFixes) {
      console.log(`     ❌ ${f.item.description.slice(0, 80)}`);
    }
    for (const r of failedReviews) {
      console.log(`     ⚡ ${r.taskId}: ${r.note}`);
    }
  }

  console.log("\n💡 下一步：运行 npx tsx scripts/ci-gate.ts 验证全部门禁。\n");

  // ── 清理 ──
  try { await memory.close(); } catch { /* 静默 */ }
  try {
    const dbPath = path.join(ROOT, ".cortex", "memory-self-fix.db");
    if (fs.existsSync(dbPath)) {
      for (const suffix of ["", "-shm", "-wal"]) {
        const fp = dbPath + suffix;
        if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch { /* 静默 */ }
      }
    }
  } catch { /* 静默 */ }
}

main().catch((err) => {
  console.error("自主修复异常终止", err);
  process.exit(1);
});
