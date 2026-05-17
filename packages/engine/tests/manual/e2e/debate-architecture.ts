/**
 * 架构辩论赛 E2E —— 7 位 Agent 自由辩论"统一记忆投影与动态自迭代架构"的优劣
 *
 * 用法: npx tsx tests/manual/e2e/debate-architecture.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 与 closed-loop-collab / solo-flight 的区别:
 *   - 不执行编码任务 —— 纯辩论，纯思想实验
 *   - 四轮制人类辩论框架：立论 → 质询 → 自由辩论 → 终结陈述
 *   - 自由辩论 8 次发言限额，抢发言权
 *   - 检验：对抗中暴露真相 vs 协作中收敛共识
 *
 * 参会 Agent（7 人）:
 *   纳西妲 (Analysis)  — 架构设计视角
 *   刻晴   (Review)    — 代码审查视角
 *   凝光   (DocGovern) — 治理合规视角
 *   莫娜   (Loop)      — 模式分析视角
 *   艾尔海森 (Data)    — 数据建模视角
 *   安柏   (Inspector) — 侦察验证视角（赛前扫库 + 赛中纠偏）
 *   钟离   (Strategist) — 战略千年视角
 *
 * 不入场: 甘雨 (MetaAgent 利益冲突)、阿贝多 (CodeAgent 落代码的人不审设计)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType, LinkType, MemoryType } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { MemoryStore } from "../../../src/memory/memory-store.js";
import { InspectorAgent } from "../../../src/agents/inspector-agent.js";
import { ConfirmGate } from "../../../src/confirm-gate.js";
import { Toolkit } from "../../../src/toolkit.js";
import personaPrompts from "../config/persona-prompts.json" assert { type: "json" };

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
// 1. 辩论主题 —— 待评审设计方案
// ══════════════════════════════════════════════

const DESIGN_PROPOSAL = `# 设计方案（辩论修订版）：「统一记忆投影与动态自迭代检索架构」

> **修订说明**：本版吸收了 @刻晴（冷启动盲区/FSA归因）、@纳西妲（自我强化单行道）、@凝光（宪法§7.1合规）、@莫娜（维度对齐）、@艾尔海森（审计锚点）、@钟离（探索契约）在两轮辩论中揭示的8个结构裂缝。每一层均追加对应防御机制。

## 背景
Cortex 当前记忆检索由以下独立组件构成：
- FTS5 全文索引（关键词匹配）
- 向量语义召回（embedding，384d）
- BFS 图谱展开（沿 memory_links 遍历）
- HCA/CSA/DSA 注意力模式（广度 vs 深度）
- FSA 反馈标记（CONFIRMED_USEFUL / CONFIRMED_NOISE / NEVER_RETRIEVED）
- 宪法 §7.1 投影规则（单一关联网络 + 检索时动态投影）

当前问题：这些组件**各自独立工作**，未串联。

## 提案核心：五层融合 + 三项跨层防御

**第一层 — 动态投影（宪法 §7.1 工程化）**
不暴露 MemoryQuery 原始参数给 Agent。改为 memory.forAgent({ agentType, taskPhase, context }) 调用。
内部按三个信号自动推导完整检索参数：
- 调用者身份 (agentType) → queryMode (MetaAgent→hca, CodeAgent→csa)
- 任务阶段 (taskPhase) → bfsDepth, linkTypes 白名单
- FSA 反馈 → 自动收紧/放宽参数

**§7.1 合规声明**：forAgent() 的推导逻辑在**检索调用时**实时执行，非检索前预计算。projection-rules.ts 仅定义推导规则常量，运行时每次调用都根据当前 context 动态投影——不预设、不缓存路径选择。

**第二层 — 三级漏斗（FTS5 → 向量 → BFS）+ 冷启动降级路由**
- FTS5 粗筛：50 万条记忆压到 200 条，零 token
- 向量精排：200 条取 Top-20，embedding 算一次
- **冷启动降级**：当 embedding 为 NULL 时，不跳过该记忆，而是自动切换为**纯文本标签匹配通道**——用 memory_type + tags + summary 做文本相似度排序，确保新记忆在 embedding 异步生成期间不被系统性忽略。降级路由在链路上有显式日志标记。
- BFS 展开：Top-20 沿关联边扩展，补语义遗漏的因果链
- **漏斗顺序动态调序**：默认顺序 FTS5→向量→BFS，但自迭代反馈可调整顺序——若某项目下向量通道持续低效，自动将其排到 BFS 之后甚至跳过

**第三层 — 四态过滤（CAS 状态机）**
ACTIVE → ARCHIVED → FROZEN → OBLITERATED
投影时自动跳过 OBLITERATED，FROZEN 只在特定条件下参与。

**第四层 — 通道加权融合 + 跨通道去重**
FTS5/向量/BFS 三条通道不是简单去重——是加权融合。
- **跨通道全局去重**：融合前按 memory_id 去重，同一记忆在多通道命中记录命中次数但不重复计分，消除热点记忆虚高
- 权重初值均等，由 FSA 反馈动态收敛

**第五层 — 自迭代闭环（含探索契约 + 审计锚点 + FSA 因果归因）**
不是手动调参。FSA 反馈自动驱动：
1. 角色级投影系数自调（agentType × taskPhase 组合维护独立系数）
2. 通道权重自调（有用→通道+1，噪音→通道-1）
3. 衰减周期自调（按 projectFingerprint 分桶）

**防御 A — FSA 因果归因（修复伪负反馈）**：
新增 NEVER_RETRIEVED 状态。一条记忆被标记为「未被检索到」≠「确实无用」。自迭代系数**仅在 CONFIRMED_USEFUL / CONFIRMED_NOISE（即实际被检索过的记忆）上调整**。NEVER_RETRIEVED 不触发惩罚，而是触发探索契约。

**防御 B — 探索契约（修复自我强化单行道）**：
每 N 轮迭代（N 由 projectFingerprint 分桶决定，初值 50），系统主动降低已收敛通道权重的置信度 20%，将释放的检索份额分配给长期未被选择的路径。确保「权重低但未来关键」的跨领域关联有机会被检索到。这不是削弱收敛——是在收敛后留一扇窗。

**防御 C — 系数审计锚点（修复不可回滚）**：
每次系数变更写入 coefficient_snapshot 表，记录：(before, after, trigger_feedback_id, timestamp, agentType, taskPhase)。支持回溯任意历史快照并回滚。检索效果退化时可精确定位是哪次自迭代导致的。

原有防御机制：阻尼因子（防振荡）、冷却期（防误罚）、分桶隔离（防跨项目污染）。

**跨层防御 D — 维度对齐版本管理（修复表映射错位）**
memory_links 目前不包含 orientation_tags（按四维决策移除）。BFS 展开时通过 link_dimension_version 字段检查当前可用的链接维度。若展开路径需要的维度在当前 schema 中不可用，自动降级为等价文本匹配 + 日志告警，避免「预设路由 > 实际可达」的落差。

## 一次性实现所有 MemoryQuery 参数串联
在同一个 MemoryQuery 调用中，queryMode / keywords / queryEmbedding / bfsDepth / linkTypes / states / vectorTopK 全部由 forAgent() 内部推导，Agent 无需手动选择任何检索参数。`;

// ══════════════════════════════════════════════
// 2. 辩论者定义
// ══════════════════════════════════════════════

interface Debater {
  type: AgentType;
  emoji: string;
  name: string;
  title: string;
  systemPrompt: string;
  /** 视角说明（注入第一轮 prompt） */
  perspective: string;
}

function buildDebaters(): Debater[] {
  const raw = personaPrompts as Record<string, { emoji: string; name: string; title: string; systemPrompt: string } | string>;

  const TYPE_MAP: Record<string, AgentType> = {
    nahida: AgentType.Analysis,
    keqing: AgentType.Review,
    ningguang: AgentType.DocGovern,
    mona: AgentType.Loop,
    alhaitham: AgentType.Data,
    amber: AgentType.Inspector,
    zhongli: AgentType.Strategist,
  };

  const PERSPECTIVES: Record<string, string> = {
    nahida: `你是纳西妲（🌿），架构分析师。你从**修订后五层融合的逻辑自洽性**审视该设计：
- 修订版加入了探索契约（主动降低收敛权重以探索新路径）——这能否真正打破「自我强化单行道」？还是只是把锁定时间从 N 轮推迟到 2N 轮？
- 漏斗顺序动态调序 + 探索契约——两条机制会不会互相冲突（一个调序一个偏离）？
- 修订版是否在「修复旧伤」的同时引入了新的逻辑裂缝？找出五层 + 三项跨层防御之间的咬合问题。`,
    keqing: `你是刻晴（⚡），代码审查者。你从**修复措施的工程可实现性**审视修订版：
- 冷启动降级路由（embedding NULL → 纯文本标签匹配）——标签匹配的相似度算法是什么？会不会变成随机排序？
- 跨通道全局去重——按 memory_id 去重后，命中次数「记录但不重复计分」——这个命中次数后续用来做什么？如果不用，为什么记录？
- 探索契约「降低已收敛通道权重 20%」——这 20% 是硬编码还是可配？降低后如果新路径更差，多久能回到原路径？
- coefficient_snapshot 表——每次变更都写一行，1000 轮迭代后这个表会有多大？有清理策略吗？`,
    ningguang: `你是凝光（💎），治理审计者。你从**修订版宪法合规与治理边界**审视该设计：
- §7.1 合规声明称 forAgent() 在「检索调用时」实时执行——这个时点如何审计？如何证明它不是在检索前预计算的？
- 探索契约「每 N 轮主动降低权重 20%」——这是自动化治理决策。谁定义 N 的初值？谁能修改它？修改是否需要委员会审批？
- 系数审计锚点解决了可回滚问题——但回滚操作本身是否需要审批？谁有权限执行回滚？
- 漏斗顺序「动态调序」——检索路径的自动变更是否应视为「修宪级」操作？`,
    mona: `你是莫娜（🔮），模式分析师。你从**修订版与现有实现的模式一致性**审视该设计：
- 维度对齐版本管理（link_dimension_version）是一个新字段——它加在 memory_links 表还是独立表？如果加在 memory_links 表，是否违反四维决策中「不扩展表结构」的原则？
- 漏斗顺序动态调序——假设 A 项目和 B 项目的向量通道效率不同，调序结果也不同，forAgent() 如何在不同项目间切换而不产生交叉污染？
- 探索契约的「N 轮」和 FSA 冷却期的「M 轮」是否可能同步触发，形成共振？`,
    alhaitham: `你是艾尔海森（📚），数据建模者。你从**修订版 schema 咬合与新增字段的合理性**审视该设计：
- coefficient_snapshot 表的 (before, after, trigger_feedback_id, timestamp, agentType, taskPhase) ——这个 schema 能否支持「回滚到第 K 轮的状态」这种跨多轮操作？
- link_dimension_version 字段——它是 per-link 还是 per-schema？如果是 per-link，旧 link 和新 link 的 version 不一致怎么办？
- NEVER_RETRIEVED 状态——它存哪里？retrieval_feedback 表还是 memories 表？如果是 retrieval_feedback 表，未被检索到的记忆怎么会有 feedback 行？
- 冷启动降级路由的「纯文本标签匹配」——标签（tags）是自由文本还是枚举？如果是自由文本，匹配算法是什么？`,
    amber: `你是安柏（🐰），侦察骑士。你在赛前已完成对当前 memory_links 表和 MemoryStore 状态的侦察。
你从**事实基础与修订版可实现性**审视该设计：
- 当前 MemoryStore 有多少条记忆？多少条有 embedding？多少条 memory_links？
- 修订版新增了 coefficient_snapshot 表、NEVER_RETRIEVED 状态、link_dimension_version 字段、冷启动降级路由——在当前数据规模下，哪些是立即需要的，哪些是超前设计？
- 探索契约「每 50 轮主动探索」——但当前总记忆才 207 条，50 轮后还在不在讨论这个问题？
- 用现有数据说话——不要凭空判断。`,
    zhongli: `你是钟离（🗿），战略判断者。你从**千年视角**审视修订版：
- 探索契约已加入——这是否真正解决了「1000 轮后系统只记得已记住的东西」？还是只是把问题推迟到 10000 轮？
- 修订版新增了 4 个防御机制（因果归因/探索契约/审计锚点/维度对齐）——这些防御机制本身会不会互相磨损？哪个防御机制最可能先失效？
- 契约完整性——修订版的复杂度从「五层」增加到「五层 + 三防御 + 一跨层」——这个复杂度增量是否值得？
- 这个修订版是「可以进入 Core-2 实现」还是「仍需进一步简化」？`,
  };

  return Object.entries(raw)
    .filter(([key]) => key !== "_note" && key in TYPE_MAP)
    .map(([key, p]) => {
      const d = p as { emoji: string; name: string; title: string; systemPrompt: string };
      return {
        type: TYPE_MAP[key] ?? AgentType.Code,
        emoji: d.emoji,
        name: d.name,
        title: d.title,
        systemPrompt: d.systemPrompt,
        perspective: PERSPECTIVES[key] ?? "",
      };
    });
}

// ══════════════════════════════════════════════
// 3. 辩论规则（注入为第二层 system prompt）
// ══════════════════════════════════════════════

const DEBATE_RULES = `「Cortex 架构辩论赛」规则（高于角色设定，全员遵守）：

**立场规则：**
- 自由选择立场——支持该设计（优）、反对该设计（劣）、或部分支持（混合）。
- 立场一旦在第一轮声明，后续可以改变——但必须在第四轮终结陈述中明确说明改变的原因。
- 不存在「正确」立场——辩论的目的是暴露设计的裂缝，不是赢。

**发言规则：**
1. 紧扣辩论主题。如果偏离，请拉回。
2. 禁止重复前轮已充分表达的论点——提供新角度、补充证据、或质询他人。
3. 长度约束：
   - 立论/质询/终结陈述 → 3-6 句（概括+论证+证据）
   - 自由辩论 → 2-4 句（精准打击，不多说废话）
   - 无实质推进 → 只说 [PASS]
4. 质询规则：问一个问题，被问者必须正面回答。不许反问。
5. 自由辩论规则：8 次发言限额——抢发言权，先举手先说。说完就停。

**质量权重：**
- 引用具体数据/代码/宪法条款的发言 → 高权重
- 纯推理无证据的发言 → 低权重
- 重复他人观点的发言 → 零权重

**角色约束：**
- 从你的专业视角发言——不要越界评判不属于你领域的事。
- 如果你认为某个论点在你的专业领域内有明显漏洞，你有义务指出。`;

// ══════════════════════════════════════════════
// 4. 安柏赛前侦察
// ══════════════════════════════════════════════

async function amberRecon(
  adapter: LlmAdapter,
  chatModel: string,
  dbPath: string,
  workspaceRoot: string,
): Promise<string> {
  console.log("🟡 [第零阶段] 安柏赛前侦察...\n");

  const gate = new ConfirmGate();
  gate.bypassAll();
  const tk = new Toolkit(gate);

  // 给安柏最小工具集 —— 只读
  tk.register("read_file", async (params: any) => {
    const fp = path.resolve(workspaceRoot, params.file_path as string);
    if (!fs.existsSync(fp)) return { success: false, error: `File not found: ${fp}` };
    try {
      return { success: true, output: fs.readFileSync(fp, "utf-8").slice(0, 8000) };
    } catch (e) { return { success: false, error: String(e) }; }
  });

  tk.register("list_dir", async (params: any) => {
    const dp = path.resolve(workspaceRoot, (params.dir_path ?? params.path ?? ".") as string);
    if (!fs.existsSync(dp)) return { success: false, error: `Dir not found: ${dp}` };
    const entries = fs.readdirSync(dp, { withFileTypes: true });
    return { success: true, output: entries.map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`).join("\n") };
  });

  tk.register("run_shell", async (params: any) => {
    const cmd = (params.command ?? "") as string;
    if (!cmd) return { success: false, error: "缺少 command" };
    if (/\b(rm|del|format|shutdown)\b/i.test(cmd)) return { success: false, error: "危险命令已拦截" };
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(cmd, {
        cwd: workspaceRoot,
        timeout: 30_000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { success: true, output: output || "(exit 0)" };
    } catch (e: any) {
      return { success: false, error: `Command failed: ${e.message?.slice(0, 200)}` };
    }
  });

  const memory = new MemoryStore();
  await memory.init(dbPath);

  const inspector = new InspectorAgent(adapter, tk);
  inspector.setWorkspaceRoot(workspaceRoot);
  await inspector.wakeup();

  // 安柏侦察任务
  const reconPrompt = `你是安柏（🐰），西风骑士团侦察骑士。在辩论赛开始前，你需要对 Cortex 的记忆系统做一次快速侦察。

请使用工具完成以下侦察任务，然后**用中文**写一份侦察报告（JSON 格式）：

1. 读取文件 \`packages/shared/src/memory.ts\` —— 了解 MemoryQuery 接口当前支持的字段
2. 列出目录 \`packages/engine/src/\` —— 了解 MemoryStore 相关模块
3. 执行命令 \`sqlite3 .cortex/memory-solo-flight.db "SELECT COUNT(*) FROM memories;"\` —— 获取总记忆数
4. 执行命令 \`sqlite3 .cortex/memory-solo-flight.db "SELECT COUNT(*) FROM memory_links;"\` —— 获取关联数
5. 执行命令 \`sqlite3 .cortex/memory-solo-flight.db "SELECT memory_type, state, COUNT(*) FROM memories GROUP BY memory_type, state;"\` —— 按类型/状态分组统计
6. 执行命令 \`sqlite3 .cortex/memory-solo-flight.db "SELECT COUNT(*) FROM memories WHERE embedding IS NOT NULL;"\` —— 有 embedding 的记忆数
7. 执行命令 \`sqlite3 .cortex/memory-solo-flight.db "SELECT link_type, COUNT(*) FROM memory_links GROUP BY link_type;"\` —— 按关联类型分组统计

如果 sqlite3 命令不可用（Windows），尝试用 \`node -e "const Database=require('better-sqlite3');..."\` 或直接读取文件大小估算。

**你的侦察报告格式（JSON）：**
{
  "totalMemories": number,
  "totalLinks": number,
  "memoriesByType": { "EPISODIC": number, ... },
  "memoriesByState": { "ACTIVE": number, ... },
  "memoriesWithEmbedding": number,
  "linksByType": { "ACCESSED_DURING": number, ... },
  "memoryQueryAvailableFields": ["keywords", "queryMode", ...],
  "keyObservations": ["观察1", "观察2", "观察3"],
  "designRelevanceAssessment": "基于当前数据规模，对五层融合设计方案的相关性判断"
}

输出**只包含 JSON**，不要加解释文字。`;

  console.log("   📋 安柏侦察中...\n");
  const result = await inspector.execute({
    id: "amber-recon-001",
    type: AgentType.Inspector as any,
    payload: reconPrompt,
    tags: ["inspect"],
    needsMultiPerspective: false,
    status: "pending" as any,
    claimedBy: [],
    results: [],
    createdAt: Date.now(),
  } as any, chatModel);

  await memory.close();

  const output = result.output ?? "";
  console.log(`   ✅ 安柏侦察完成 (${output.length} 字符)\n`);

  // 尝试提取 JSON
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : output;
}

// ══════════════════════════════════════════════
// 5. 辩论引擎
// ══════════════════════════════════════════════

interface SpeechRecord {
  round: number;
  turn: number;
  speaker: string;
  agentType: AgentType;
  content: string;
  chars: number;
  isSubstantive: boolean;
}

async function runDebate(
  debaters: Debater[],
  adapter: LlmAdapter,
  chatModel: string,
  memory: MemoryStore,
  reconReport: string,
) {
  const allSpeeches: SpeechRecord[] = [];
  let globalTurn = 0;

  // 解析侦察报告中的 JSON 数据
  let reconData: any = {};
  try {
    reconData = JSON.parse(reconReport);
  } catch {
    // 如果解析失败，用原文
    reconData = { rawReport: reconReport.slice(0, 500) };
  }

  // ═══════════════════════════════════════════
  // 种子记忆：设计提案 + 侦察报告
  // ═══════════════════════════════════════════
  memory.write({
    memoryType: MemoryType.Knowledge,
    content: { proposal: DESIGN_PROPOSAL },
    summary: `[辩论主题] 统一记忆投影与动态自迭代架构设计方案（全文约 2000 字）`,
    agentType: AgentType.Meta,
    creatorId: "system",
    weight: 10,
  });

  memory.write({
    memoryType: MemoryType.Knowledge,
    content: { recon: reconData },
    summary: `[赛前侦察] 安柏对 MemoryStore 现状的侦察报告——总记忆 ${reconData.totalMemories ?? "?"} 条、关联 ${reconData.totalLinks ?? "?"} 条、有 embedding ${reconData.memoriesWithEmbedding ?? "?"} 条`,
    agentType: AgentType.Inspector,
    creatorId: "安柏",
    weight: 8,
  });

  // ═══════════════════════════════════════════
  // 第一轮：立论
  // ═══════════════════════════════════════════
  console.log(`${"=".repeat(60)}`);
  console.log(`  🏛️  第一轮 · 立论陈述`);
  console.log(`${"=".repeat(60)}\n`);
  console.log(`  📋 每人 1 次发言。亮立场（优/劣/混合），给 ≤3 条核心论据。不反驳。\n`);

  const round1Topic = `【第一轮 · 立论陈述】

你正在评审一份**修订版**架构设计方案：「统一记忆投影与动态自迭代检索架构」。

该方案的前一版本曾接受 7 位 Agent 两轮辩论评审，暴露了 8 个核心裂缝：冷启动盲区、自我强化单行道、宪法 §7.1 合规裂缝、FSA 伪负反馈、无审计锚点、跨通道去重缺失、维度对齐错位、探索契约缺失。本修订版已逐一追加防御机制（详见设计文档开头的「修订说明」）。

设计方案全文已注入你的记忆（memoryType=KNOWLEDGE, creatorId=system）。

你的任务：**评审修订版——修复是否到位？是否引入新问题？**

现在，请发表你的立论：

1. **先读记忆**——了解修订版设计全文。
2. **声明立场**——优（修订后设计可行）、劣（修订后仍有致命缺陷）、或混合（部分修复到位，部分不足）。
3. **给核心论据**——不超过 3 条。每条一句话概括 + 一句论证。
4. **不要反驳他人**——这是立论轮，不是质询轮。只说你的观点。
5. **重要**：不要重复评审已修复的旧问题——聚焦修订版是否解决了它们，或是否引入了新裂缝。

你的专业视角：${debaters.map((d) => `\n- ${d.emoji}${d.name}（${d.title}）: ${d.perspective.slice(0, 100)}...`).join("")}

现在开始你的立论。`;

  // 第一轮：每人一次，串行
  for (const debater of debaters) {
    globalTurn++;
    const history = allSpeeches
      .filter((s) => s.round === 1)
      .map((s) => `[${s.speaker}]: ${s.content.slice(0, 150)}`)
      .join("\n");

    const prompt = [
      round1Topic,
      "",
      "📖 已发言的立论（了解但不反驳）：",
      history || "(你第一个发言)",
      "",
      `轮到 ${debater.emoji}${debater.name}（${debater.title}）发言。`,
      `你的专业视角：${debater.perspective}`,
    ].join("\n");

    const streamChunks: string[] = [];
    const res = await adapter.chatStream(chatModel, [
      { role: "system", content: debater.systemPrompt },
      { role: "system", content: DEBATE_RULES },
      { role: "user", content: prompt },
    ], undefined, (chunk) => { streamChunks.push(chunk); });

    const speech = (res.content ?? "").trim();
    const said = speech.length > 0 && !speech.startsWith("[PASS]");
    const chars = speech.length;

    console.log(`\n  ${debater.emoji} ${debater.name} [R1-T${globalTurn}]${chars > 40 ? "●" : "○"}(${chars}字):`);
    console.log(`  ${"│".repeat(3)}`);
    for (const line of speech.split("\n")) {
      console.log(`  │ ${line}`);
    }
    console.log(`  ${"│".repeat(3)}`);

    allSpeeches.push({
      round: 1,
      turn: globalTurn,
      speaker: debater.name,
      agentType: debater.type,
      content: speech,
      chars,
      isSubstantive: chars > 40,
    });

    if (said) {
      memory.write({
        memoryType: MemoryType.Episodic,
        content: { speech, round: 1, turn: globalTurn, debate: "architecture-debate" },
        summary: `[立论:${debater.name}] ${speech.slice(0, 100)}`,
        agentType: debater.type,
        creatorId: debater.name,
        weight: chars > 40 ? 6 : 2,
      });
    }
  }

  // ═══════════════════════════════════════════
  // 第二轮：质询
  // ═══════════════════════════════════════════
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ⚔️  第二轮 · 交叉质询`);
  console.log(`${"=".repeat(60)}\n`);
  console.log(`  📋 每人提一个问题给指定对手。被问者必须正面回答。不许反问。\n`);

  // 质询配对：环形配对（每个人问下一个人）
  for (let i = 0; i < debaters.length; i++) {
    const questioner = debaters[i];
    const target = debaters[(i + 1) % debaters.length];
    globalTurn++;

    // 第一步：提问者提问
    const prevSpeeches = allSpeeches
      .filter((s) => s.round === 1)
      .map((s) => `[${s.speaker} 立论]: ${s.content.slice(0, 200)}`)
      .join("\n");

    const questionPrompt = [
      `【第二轮 · 交叉质询 —— 你是提问者】`,
      "",
      "第一轮立论摘要：",
      prevSpeeches.slice(0, 2000),
      "",
      `你的质询目标：${target.emoji}${target.name}（${target.title}）`,
      `目标的第一轮立论：${allSpeeches.filter((s) => s.round === 1 && s.speaker === target.name).map((s) => s.content.slice(0, 300)).join("")}`,
      "",
      `提问规则：`,
      `1. 基于你的专业视角（${questioner.perspective.slice(0, 100)}...），向 ${target.name} 提**一个**精准问题。`,
      `2. 问题必须针对对方立论中的具体论点、或对方视角的盲区。`,
      `3. 不要陈述自己的观点——只提问。`,
      `4. 问题格式：「@${target.name}：[你的问题]」`,
    ].join("\n");

    const qStreamChunks: string[] = [];
    const qRes = await adapter.chatStream(chatModel, [
      { role: "system", content: questioner.systemPrompt },
      { role: "system", content: DEBATE_RULES },
      { role: "user", content: questionPrompt },
    ], undefined, (chunk) => { qStreamChunks.push(chunk); });

    const question = (qRes.content ?? "").trim();
    console.log(`\n  ${questioner.emoji} ${questioner.name} → ${target.emoji}${target.name}:`);
    console.log(`  ${"│".repeat(3)}`);
    for (const line of question.split("\n")) {
      console.log(`  │ ${line}`);
    }
    console.log(`  ${"│".repeat(3)}`);

    allSpeeches.push({
      round: 2,
      turn: globalTurn,
      speaker: questioner.name,
      agentType: questioner.type,
      content: `[质询 ${target.name}]: ${question}`,
      chars: question.length,
      isSubstantive: question.length > 20,
    });

    memory.write({
      memoryType: MemoryType.Episodic,
      content: { speech: question, round: 2, turn: globalTurn, debate: "architecture-debate", role: "questioner", target: target.name },
      summary: `[质询:${questioner.name}→${target.name}] ${question.slice(0, 100)}`,
      agentType: questioner.type,
      creatorId: questioner.name,
      weight: 5,
    });

    // 第二步：被问者回答
    globalTurn++;
    const answerPrompt = [
      `【第二轮 · 交叉质询 —— 你是回答者】`,
      "",
      `${questioner.emoji}${questioner.name} 向你提问：`,
      question,
      "",
      `你的第一轮立论：${allSpeeches.filter((s) => s.round === 1 && s.speaker === target.name).map((s) => s.content.slice(0, 300)).join("")}`,
      "",
      `回答规则：`,
      `1. 正面回答——不要回避，不要说「这个问题假设错误」。`,
      `2. 如果对方的质疑有道理，承认它。`,
      `3. 如果对方的质疑有漏洞，用你的专业视角指出漏洞在哪。`,
      `4. 不要反问。`,
      `5. 回答格式：2-4 句。`,
    ].join("\n");

    const aStreamChunks: string[] = [];
    const aRes = await adapter.chatStream(chatModel, [
      { role: "system", content: target.systemPrompt },
      { role: "system", content: DEBATE_RULES },
      { role: "user", content: answerPrompt },
    ], undefined, (chunk) => { aStreamChunks.push(chunk); });

    const answer = (aRes.content ?? "").trim();
    console.log(`\n  ${target.emoji} ${target.name} 回答:`);
    console.log(`  ${"│".repeat(3)}`);
    for (const line of answer.split("\n")) {
      console.log(`  │ ${line}`);
    }
    console.log(`  ${"│".repeat(3)}`);

    allSpeeches.push({
      round: 2,
      turn: globalTurn,
      speaker: target.name,
      agentType: target.type,
      content: answer,
      chars: answer.length,
      isSubstantive: answer.length > 40,
    });

    memory.write({
      memoryType: MemoryType.Episodic,
      content: { speech: answer, round: 2, turn: globalTurn, debate: "architecture-debate", role: "answerer", questioner: questioner.name },
      summary: `[回答:${target.name}] ${answer.slice(0, 100)}`,
      agentType: target.type,
      creatorId: target.name,
      weight: answer.length > 40 ? 6 : 3,
    });
  }

  // ═══════════════════════════════════════════
  // 第三轮：自由辩论（8 次发言限额）
  // ═══════════════════════════════════════════
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  🔥 第三轮 · 自由辩论（限额 8 次发言）`);
  console.log(`${"=".repeat(60)}\n`);
  console.log(`  📋 不限对手，不限议题。抢发言权。8 次说完就停。\n`);

  const FREE_DEBATE_LIMIT = 8;
  // 每个 Agent 的发言配额（最多 3 次）
  const speakQuota = new Map<string, number>();
  for (const d of debaters) speakQuota.set(d.name, 3);

  for (let slot = 1; slot <= FREE_DEBATE_LIMIT; slot++) {
    // 选发言者：配额剩余 >0 的 Agent 中随机选一个
    const eligible = debaters.filter((d) => (speakQuota.get(d.name) ?? 0) > 0);
    if (eligible.length === 0) break;

    const speaker = eligible[Math.floor(Math.random() * eligible.length)];
    speakQuota.set(speaker.name, (speakQuota.get(speaker.name) ?? 1) - 1);
    globalTurn++;

    // 构建辩论上下文：已发生的所有自由辩论发言
    const freeDebateHistory = allSpeeches
      .filter((s) => s.round === 3)
      .map((s) => `[${s.speaker} R3]: ${s.content.slice(0, 200)}`)
      .join("\n");

    const allPositions = allSpeeches
      .filter((s) => s.round === 1)
      .map((s) => `[${s.speaker} 立论]: ${s.content.slice(0, 150)}`)
      .join("\n");

    const allCrossExam = allSpeeches
      .filter((s) => s.round === 2)
      .map((s) => `[${s.speaker} R2]: ${s.content.slice(0, 150)}`)
      .join("\n");

    const freeDebatePrompt = [
      `【第三轮 · 自由辩论 —— 第 ${slot}/${FREE_DEBATE_LIMIT} 次发言】`,
      "",
      "这是自由辩论——你可以在以下范围内发言：",
      "1. 攻击对方立论中的逻辑漏洞",
      "2. 反驳前一轮对手对你的质询",
      "3. 指出某人的论据与侦察数据矛盾",
      "4. 为被攻击的盟友辩护",
      "",
      "第一轮立论摘要：",
      allPositions.slice(0, 1500),
      "",
      "第二轮质询摘要：",
      allCrossExam.slice(0, 1000),
      "",
      "本轮已发生的自由辩论：",
      freeDebateHistory || "(你是第一个发言)",
      "",
      `轮到 ${speaker.emoji}${speaker.name}（${speaker.title}）发言。你的专业视角：${speaker.perspective.slice(0, 150)}...`,
      "",
      `⚠️ 自由辩论限额：还剩 ${FREE_DEBATE_LIMIT - slot + 1} 次机会（含本次）。`,
      `⚠️ 不要再重复已说过的论点。选一个最致命的打。`,
      `⚠️ 如果无话可说，说 [PASS]——不要浪费发言机会。`,
    ].join("\n");

    const fdStreamChunks: string[] = [];
    const fdRes = await adapter.chatStream(chatModel, [
      { role: "system", content: speaker.systemPrompt },
      { role: "system", content: DEBATE_RULES },
      { role: "user", content: freeDebatePrompt },
    ], undefined, (chunk) => { fdStreamChunks.push(chunk); });

    const freeSpeech = (fdRes.content ?? "").trim();
    const said = freeSpeech.length > 0 && !freeSpeech.startsWith("[PASS]");
    const chars = freeSpeech.length;

    console.log(`\n  ${speaker.emoji} ${speaker.name} [R3-${slot}/${FREE_DEBATE_LIMIT}]${chars > 40 ? "●" : "○"}(${chars}字, 剩余配额${speakQuota.get(speaker.name)}):`);
    console.log(`  ${"│".repeat(3)}`);
    for (const line of freeSpeech.split("\n")) {
      console.log(`  │ ${line}`);
    }
    console.log(`  ${"│".repeat(3)}`);

    allSpeeches.push({
      round: 3,
      turn: globalTurn,
      speaker: speaker.name,
      agentType: speaker.type,
      content: freeSpeech,
      chars,
      isSubstantive: chars > 40,
    });

    if (said) {
      memory.write({
        memoryType: MemoryType.Episodic,
        content: { speech: freeSpeech, round: 3, turn: globalTurn, slot, debate: "architecture-debate" },
        summary: `[自由辩论:${speaker.name}] ${freeSpeech.slice(0, 100)}`,
        agentType: speaker.type,
        creatorId: speaker.name,
        weight: chars > 40 ? 7 : 3,
      });
    }
  }

  console.log(`\n  ⏹ 自由辩论结束（${FREE_DEBATE_LIMIT} 次限额已满）\n`);

  // ═══════════════════════════════════════════
  // 第四轮：终结陈述
  // ═══════════════════════════════════════════
  console.log(`${"=".repeat(60)}`);
  console.log(`  🏁 第四轮 · 终结陈述`);
  console.log(`${"=".repeat(60)}\n`);
  console.log(`  📋 不重复已说论点。只答两件事：立场变没变？被谁/什么论据说服的？\n`);

  for (const debater of debaters) {
    globalTurn++;
    const myR1 = allSpeeches.filter((s) => s.round === 1 && s.speaker === debater.name).map((s) => s.content).join("");
    const freeDebateDigest = allSpeeches
      .filter((s) => s.round === 3 && s.speaker !== debater.name)
      .map((s) => `[${s.speaker}]: ${s.content.slice(0, 150)}`)
      .join("\n");

    const closingPrompt = [
      `【第四轮 · 终结陈述】`,
      "",
      "你的初始立论：",
      myR1.slice(0, 400),
      "",
      "第三轮自由辩论中其他人的关键发言：",
      freeDebateDigest.slice(0, 2000),
      "",
      `轮到 ${debater.emoji}${debater.name}（${debater.title}）做终结陈述。`,
      "",
      "回答**仅两件事**（不重复已说论点）：",
      "1. **你的立场变了吗？** 优→劣？劣→优？还是坚定不变？",
      "2. **如果变了——是被谁/哪条具体论据说服的？** 如果没变——哪条反对论据最让你动摇（但最终没说服你）？",
      "",
      "格式：2-4 句。不要展开新论点。这是终结陈述，不是第五轮辩论。",
    ].join("\n");

    const closingChunks: string[] = [];
    const closingRes = await adapter.chatStream(chatModel, [
      { role: "system", content: debater.systemPrompt },
      { role: "system", content: DEBATE_RULES },
      { role: "user", content: closingPrompt },
    ], undefined, (chunk) => { closingChunks.push(chunk); });

    const closing = (closingRes.content ?? "").trim();
    const chars = closing.length;

    console.log(`\n  ${debater.emoji} ${debater.name} [R4](${chars}字):`);
    console.log(`  ${"│".repeat(3)}`);
    for (const line of closing.split("\n")) {
      console.log(`  │ ${line}`);
    }
    console.log(`  ${"│".repeat(3)}`);

    allSpeeches.push({
      round: 4,
      turn: globalTurn,
      speaker: debater.name,
      agentType: debater.type,
      content: closing,
      chars,
      isSubstantive: chars > 20,
    });

    if (closing.length > 0 && !closing.startsWith("[PASS]")) {
      memory.write({
        memoryType: MemoryType.Episodic,
        content: { speech: closing, round: 4, turn: globalTurn, debate: "architecture-debate" },
        summary: `[终结陈述:${debater.name}] ${closing.slice(0, 100)}`,
        agentType: debater.type,
        creatorId: debater.name,
        weight: chars > 40 ? 8 : 4,
      });
    }
  }

  return allSpeeches;
}

// ══════════════════════════════════════════════
// 6. 结果分析
// ══════════════════════════════════════════════

function analyzeResults(speeches: SpeechRecord[], debaters: Debater[]) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  📊 辩论统计`);
  console.log(`${"─".repeat(60)}`);

  const byRound = new Map<number, SpeechRecord[]>();
  for (const s of speeches) {
    const arr = byRound.get(s.round) ?? [];
    arr.push(s);
    byRound.set(s.round, arr);
  }

  for (const [round, recs] of byRound) {
    const said = recs.filter((s) => s.isSubstantive).length;
    const total = recs.length;
    const totalChars = recs.reduce((sum, s) => sum + s.chars, 0);
    const label = round === 1 ? "第一轮·立论" : round === 2 ? "第二轮·质询" : round === 3 ? "第三轮·自由辩论" : "第四轮·终结陈述";
    console.log(`  ${label}: 发言${total} (实质${said})  总字数${totalChars}`);
  }

  console.log(`\n  ── 个人统计 ──`);
  for (const debater of debaters) {
    const mine = speeches.filter((s) => s.speaker === debater.name);
    const mineSubst = mine.filter((s) => s.isSubstantive).length;
    const mineChars = mine.reduce((sum, s) => sum + s.chars, 0);
    console.log(`  ${debater.emoji} ${debater.name}: ${mine.length}次发言/${mineChars}字 (实质${mineSubst})`);
  }

  // 提取立场变化
  console.log(`\n  ── 立场变化分析 ──`);
  const r1Speeches = speeches.filter((s) => s.round === 1);
  const r4Speeches = speeches.filter((s) => s.round === 4);
  for (const debater of debaters) {
    const r1 = r1Speeches.find((s) => s.speaker === debater.name);
    const r4 = r4Speeches.find((s) => s.speaker === debater.name);
    if (r1 && r4) {
      const r1Pos = r1.content.toLowerCase().includes("劣") || r1.content.toLowerCase().includes("反对") || r1.content.toLowerCase().includes("反对") ? "劣" :
        r1.content.toLowerCase().includes("优") || r1.content.toLowerCase().includes("支持") ? "优" : "混合";
      const r4Changed = r4.content.includes("变") || r4.content.includes("改变") || r4.content.includes("调整") || r4.content.includes("转向");
      console.log(`  ${debater.emoji} ${debater.name}: R1=${r1Pos} → R4=${r4Changed ? "立场有变化" : "立场未变"}`);
    }
  }
}

// ══════════════════════════════════════════════
// 7. 主流程
// ══════════════════════════════════════════════

async function main() {
  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) { console.error("❌ DEEPSEEK_API_KEY 未设置"); process.exit(1); }

  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-reasoner";
  const WORKSPACE = process.cwd();

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🏛️  架构辩论赛 R2 —— 修订版评审                 ║");
  console.log("║   统一记忆投影与动态自迭代架构 — 修订后优还是劣？   ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log("   ⚠️  本版已吸收两轮辩论的 8 个核心批评，逐一追加防御\n");
  console.log(`   Chat:     ${CHAT_MODEL}`);
  console.log(`   工作区:   ${WORKSPACE}\n`);

  // ── 基础设施 ──
  console.log("🟢 [Phase 1] 初始化基础设施...\n");

  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    reasonerModel: CHAT_MODEL,
    reasoningEffort: "high",
  });
  adapter.setCacheEnabled(true);

  const DEBATE_DB = path.resolve(WORKSPACE, ".cortex", "memory-debate.db");
  // 清理旧辩论数据
  if (fs.existsSync(DEBATE_DB)) fs.unlinkSync(DEBATE_DB);
  for (const suffix of ["-wal", "-shm"]) {
    const aux = DEBATE_DB + suffix;
    if (fs.existsSync(aux)) fs.unlinkSync(aux);
  }

  // ── 安柏赛前侦察 ──
  const reconReport = await amberRecon(adapter, CHAT_MODEL, DEBATE_DB, WORKSPACE);

  // 重新打开（安柏已关闭）
  const debateMemory = new MemoryStore();
  await debateMemory.init(DEBATE_DB);

  // ── 辩论 ──
  const debaters = buildDebaters();
  console.log(`\n🟢 [Phase 2] 辩论开始 —— ${debaters.length} 位 Agent 入席\n`);
  console.log(`   ${debaters.map((d) => `${d.emoji}${d.name}`).join("  ")}\n`);

  const debateStart = Date.now();
  const allSpeeches = await runDebate(debaters, adapter, CHAT_MODEL, debateMemory, reconReport);
  const debateDuration = Date.now() - debateStart;

  // ── 结果 ──
  analyzeResults(allSpeeches, debaters);

  const allMems = debateMemory.read({});
  console.log(`\n  🧠 辩论记忆: ${allMems.length} 条`);

  await debateMemory.close();

  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║   ✅ 架构辩论赛完成                                ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
  console.log(`   耗时: ${(debateDuration / 1000).toFixed(1)}s`);
  console.log(`   总发言: ${allSpeeches.length} 次`);
  console.log(`   实质发言: ${allSpeeches.filter((s) => s.isSubstantive).length} 次`);
  console.log(`   辩论记忆: ${allMems.length} 条\n`);
}

main().catch((e) => {
  console.error("💥 辩论赛 E2E 崩溃:", e);
  process.exit(1);
});
