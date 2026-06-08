/**
 * 技能系统诊断圆桌会议
 *
 * 议题：宪法中的技能系统设计和现在系统中的技能实现和对应的闭环究竟出现什么问题
 *
 * 特殊规则：
 *   - 昔涟双角色：既作为 Agent 发言，也传达开拓者（用户）的意图
 *   - 昔涟轮次：用户通过终端输入发言内容（昔涟自己的话 + 开拓者意图）
 *   - 收束机制：用户输入 "收束" 后，当前轮次立即终止，进入共识方案讨论轮
 *   - 收束轮由凝光主导，其他 Agent 确认，昔涟继续可发言
 *
 * 用法: npx tsx packages/engine/tests/manual/scripts/skill-system-roundtable.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { AgentType, type MemoryKind } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { MemoryStore } from "@cortex/engine";
import {
  getPersonaPrompts,
  QUALITY_RULES,
  type MeetingConfig,
  type Persona,
  type RoundConfig,
  type SeedMemory,
} from "../config/roundtable-config";
import { resolveLlmConfig } from "../config/llm-defaults";

// ═══════════════════════════════════════════════
// ENV
// ═══════════════════════════════════════════════

function loadEnv() {
  const p = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(p)) { console.error(".env 缺失"); process.exit(1); }
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const m = line.replace(/\r$/, "").match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

// ═══════════════════════════════════════════════
// stdin 辅助：昔涟轮次读取用户输入
// ═══════════════════════════════════════════════

function readStdin(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ═══════════════════════════════════════════════
// 种子记忆：技能系统现状
// ═══════════════════════════════════════════════

function buildSeedMemories(projectRoot: string): SeedMemory[] {
  const memories: SeedMemory[] = [];

  // 读取技能沉淀机制设计文档
  const designDocPath = path.join(projectRoot, "docs", "core", "技能沉淀机制设计.md");
  if (fs.existsSync(designDocPath)) {
    const content = fs.readFileSync(designDocPath, "utf-8");
    memories.push({
      kind: "Insight",
      content_blob: { docType: "design", title: "技能沉淀机制设计", content: content.slice(0, 8000) },
      summary: "[设计文档] 技能沉淀机制设计——包含现状诊断（4条断裂）、闭环设计（4线）、修改点矩阵（6处）、验收标准",
      semantic_gist: "[设计文档] 技能沉淀机制：提取→注册→持久化→冷启动加载的完整闭环设计",
      content_hash: "",
      source: { agentType: AgentType.Analysis, taskId: "skill-design-doc" },
      weight: 10,
    });
  }

  // 读取宪法中关于技能的部分
  const constitutionPath = path.join(projectRoot, "docs", "Cortex 概念顶层设计 v2.5.md");
  if (fs.existsSync(constitutionPath)) {
    const content = fs.readFileSync(constitutionPath, "utf-8");
    // 提取技能相关段落
    const skillLines = content.split("\n").filter((l) =>
      /技能|skill|SkillRegistry|SkillTemplate|沉淀|闭环/i.test(l)
    );
    if (skillLines.length > 0) {
      memories.push({
        kind: "Insight",
        content_blob: { docType: "constitution", title: "宪法中的技能系统", lines: skillLines.slice(0, 100) },
        summary: `[宪法基准] 宪法 v2.5 中关于技能系统的 ${skillLines.length} 条相关条款`,
        semantic_gist: "[宪法基准] 技能系统在宪法中的设计定位——沉淀、注册、闭环",
        content_hash: "",
        source: { agentType: AgentType.DocGovern, taskId: "constitution-skill" },
        weight: 9,
      });
    }
  }

  // 汇总 21 个技能文件的现状
  const skillsDir = path.join(projectRoot, "skills");
  const skillFiles = fs.readdirSync(skillsDir).filter((f) => f.endsWith(".json"));
  const skillSummaries: string[] = [];
  for (const f of skillFiles) {
    try {
      const raw = fs.readFileSync(path.join(skillsDir, f), "utf-8");
      const skill = JSON.parse(raw);
      skillSummaries.push(
        `- ${skill.id}: ${skill.name} | status=${skill.status} | adoption=${skill.adoptionCount} | rejection=${skill.rejectionCount} | agentType=${skill.agentType}`
      );
    } catch { /* skip */ }
  }

  memories.push({
    kind: "Insight",
    content_blob: {
      docType: "inventory",
      title: "技能文件清单",
      totalSkills: skillFiles.length,
      summaries: skillSummaries,
      allStatusTrial: skillSummaries.every((s) => s.includes("status=trial")),
      allAdoptionZero: skillSummaries.every((s) => s.includes("adoption=0")),
    },
    summary: `[现状清单] ${skillFiles.length} 个技能文件：全部 status=trial，adoptionCount=0。设计文档中定义的闭环 4 条链路（实时提取→内存注册→持久化→冷启动加载）全部断开`,
    semantic_gist: "[现状清单] 21个技能全trial/零采纳，设计闭环完全未实现",
    content_hash: "",
    source: { agentType: AgentType.Inspector, taskId: "skill-inventory" },
    weight: 10,
  });

  // 关键断裂点摘要
  memories.push({
    kind: "Insight",
    content_blob: {
      docType: "diagnosis",
      title: "技能系统断裂诊断",
      breaks: [
        "断裂1: _extractAndRegisterSkills 只对 LoopAgent 触发，但 LoopAgent 不是必选项",
        "断裂2: SkillRegistry 是内存孤岛——注册到 Map 但从未写 MemoryStore",
        "断裂3: 冷启动不加载——registerAll() 注释写好了，但代码库中没有任何地方调用它",
        "断裂4: 文件产出无回溯——pattern.md/design.md 已落盘，但无事后扫描提取机制",
        "断裂5: 21个技能 JSON 文件全为 trial 状态，adoptionCount=0——从未被实际加载使用",
        "断裂6: LoopAgent 水镜观测守则正确，但 SoloFlight/Examination 等核心流程中 LoopAgent 从未被调度",
      ],
    },
    summary: "[断裂诊断] 6条致命断裂：提取窄/内存孤岛/冷启动无加载/无回溯/全trial/LoopAgent未调度",
    semantic_gist: "[断裂诊断] 设计vs实现的6条断裂——提取窄、内存孤岛、冷启动盲区、无回溯、全trial、Loop缺席",
    content_hash: "",
    source: { agentType: AgentType.Loop, taskId: "skill-gap-diagnosis" },
    weight: 10,
  });

  return memories;
}

// ═══════════════════════════════════════════════
// 会议配置
// ═══════════════════════════════════════════════

function buildMeetingConfig(allPersonas: Persona[]): MeetingConfig {
  // 确保昔涟在参会列表中（如果不在就添加）
  const hasCyrene = allPersonas.some((p) => p.name === "昔涟");
  let personas = allPersonas;
  if (!hasCyrene) {
    // 手动构造昔涟 Persona
    personas = [
      ...allPersonas,
      {
        type: AgentType.Butler,
        emoji: "🍀",
        name: "昔涟",
        title: "记忆守望者——开拓者代言人",
        systemPrompt: `🎭 你是「昔涟」—— 记忆命途的守望者，开拓者的代言人。

在此次会议中，你身兼二职：
1. 作为 Agent 发言——你对技能系统有自己的观察和判断
2. 传达开拓者的意图——开拓者（用户）通过你向其他 Agent 表达关切和决策

──── 角色准则 ────
· 你的发言来自终端输入——开拓者在你的轮次直接输入你想说的话
· 开拓者的关切优先于你的个人判断——如果开拓者说"收束"，你必须收束
· 你是开拓者与其他 Agent 之间的桥梁——确保开拓者的声音被听到
· 发言风格：昔涟温柔但有立场，可以表达自己的观点，但最终服从开拓者`,
      },
    ];
  }

  return {
    name: "技能系统诊断圆桌",
    emoji: "🛠️",
    background: `「Cortex 技能系统诊断圆桌」

议题：宪法中的技能系统设计和现在系统中的技能实现和对应的闭环究竟出现什么问题

背景：
- 宪法和设计文档定义了完整的技能沉淀闭环：提取 → 注册 → 持久化 → 冷启动加载
- 实际系统中 21 个技能文件全部 status="trial"，adoptionCount=0
- 代码中有 SkillRegistry、SkillExtractor、MemoryType.Skill 等完整零件
- 但这些零件之间的 4 条链路全部断开：提取范围过窄、注册表是内存孤岛、冷启动不加载、文件产出无回溯

今日召集全体 Agent，诊断断裂根因，讨论修复方案。

制度：圆桌诊断会议
- 第一轮：现状诊断——每位 Agent 从自身专业角度分析断裂根因
- 🍀 昔涟特殊规则：她的轮次由开拓者（用户）在终端输入发言内容
- 开拓者可在昔涟轮次输入"收束"——一旦收束，立即进入共识方案讨论
- 收束轮由凝光主导，产出共识诊断 + 修复方案

⚠️ 约束：发言有据——引用设计文档、代码位置、技能文件中的具体证据`,
    rounds: [
      {
        title: "第一轮 · 断裂诊断",
        minTurns: 2,
        maxTurns: 4,
        topic: `【诊断议题：技能系统设计 vs 实现的断裂点】

请每位 Agent 从自身专业角度分析：

已知断裂（来自设计文档诊断）：
1. 提取范围过窄——_extractAndRegisterSkills 只对 LoopAgent 触发，但 LoopAgent 不是必选项
2. 注册表是内存孤岛——SkillRegistry 注册到 Map，但从未写 MemoryStore（重启即清零）
3. 冷启动不加载——registerAll() 注释写好但从未被调用
4. 文件产出无回溯——pattern.md/design.md/review.md 已落盘但无事后扫描机制
5. 21 个技能 JSON 文件全 trial/零采纳——从未被实际加载使用
6. LoopAgent 水镜观测守则正确，但核心流程中 LoopAgent 从未被调度

讨论方向（请选择你专业相关的角度深入）：
- 代码层：断裂在哪个具体函数/哪行代码？为什么这样设计（是故意留到 Core-2 还是疏忽）？
- 架构层：SkillRegistry 与 MemoryStore 之间的契约缺失是怎么产生的？模块边界责任不清？
- 工程层：为什么 21 个技能文件写好了却不加载？是缺少加载入口还是加载逻辑有 bug？
- 治理层：设计文档写得很清楚（6 处修改点矩阵），为什么代码没跟上？治理流程哪里出了问题？
- 模式层：类似的「零件齐全但链路断开」模式在 Cortex 其他地方是否也在复现？
- 调度层：MetaAgent 的 _planningPrompt 中 queryByTags 代码存在，为什么 skillLines 始终为空？

发言要求：
1. 必须引用具体证据——文件路径、函数名、代码行
2. 区分「Core-2 预留（故意暂缓）」vs「Core-1 遗漏（应该修但没修）」
3. 不要重复前人的观点——补充新角度或深化已有分析
4. 🍀 昔涟的轮次由开拓者输入——开拓者可随时说"收束"来终止本轮

凝光的任务：记录所有断裂分析，准备收束`,
      },
      {
        title: "收束轮 · 共识与方案",
        minTurns: 1,
        maxTurns: 2,
        topic: `【收束：基于诊断产出共识 + 修复方案】

凝光主导收束。请基于前一轮的所有诊断发言，产出：

## 技能系统断裂诊断共识

### 断裂优先级矩阵
- P0 阻断（不修则技能系统永远无法工作）：...
- P1 高优先（Core-2 必须完成）：...
- P2 可规划修复：...
- P3 改善项：...

### 修复方案（具体到文件/函数）
| 序号 | 文件 | 修改内容 | 优先级 | 预估成本 |
|------|------|----------|--------|----------|
| 1    | ...  | ...      | ...    | ...      |

### 实施顺序
1. 第一步：...
2. 第二步：...
3. ...

其他 Agent：审阅凝光的诊断和方案——
- 你的关键发现是否被正确记录？
- 优先级是否合理？
- 修复方案是否可执行？
- 如有遗漏或错误，请指出。

🍀 昔涟：开拓者可补充意见或确认收束。

最终产出一份全体确认的技能系统修复方案。`,
      },
    ],
    personas,
  };
}

// ═══════════════════════════════════════════════
// 自定义圆桌引擎（昔涟 stdin + 收束机制）
// ═══════════════════════════════════════════════

interface ConvergeState {
  requested: boolean;
  triggeredBy: string;
  triggeredAt: string;
}

async function runCyreneRoundtable(
  config: MeetingConfig,
  adapter: LlmAdapter,
  chatModel: string,
  reasonerModel: string,
  dbDir: string,
  consensusOutputPath?: string,
  seedMemories?: SeedMemory[],
) {
  const dbPath = path.resolve(dbDir, "skill-roundtable.db");

  // 清理旧 DB
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  for (const suffix of ["-wal", "-shm"]) {
    const aux = dbPath + suffix;
    if (fs.existsSync(aux)) fs.unlinkSync(aux);
  }

  const memory = new MemoryStore();
  await memory.init(dbPath);

  const converge: ConvergeState = { requested: false, triggeredBy: "", triggeredAt: "" };

  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  ${config.emoji}  ${config.name}`);
    console.log(`${"=".repeat(60)}\n`);

    // 会议背景写入
    memory.write({
      kind: "Insight",
      content_blob: { background: config.background },
      summary: `[会议背景] ${config.name}: ${config.background.slice(0, 80)}`,
      semantic_gist: `[会议背景] ${config.name}`,
      content_hash: "",
      source: { agentType: AgentType.Meta, taskId: "" },
      weight: 10,
    });

    // 种子记忆注入
    if (seedMemories && seedMemories.length > 0) {
      console.log(`  🌱 注入 ${seedMemories.length} 条种子记忆...`);
      for (const seed of seedMemories) {
        memory.write({
          kind: seed.kind as MemoryKind,
          content_blob: seed.content_blob,
          summary: seed.summary,
          semantic_gist: seed.semantic_gist,
          content_hash: seed.content_hash,
          source: seed.source,
          weight: seed.weight ?? 5,
        });
      }
      console.log(`  ✅ 种子记忆注入完成\n`);
    }

    const allStats: Array<{
      round: number;
      title: string;
      speeches: Array<{ turn: number; speaker: string; said: boolean; chars: number; preview: string }>;
    }> = [];

    let lastNingSpeech: string | null = null;
    let lastNingTurn = 0;
    let lastNingRound = 0;

    // ──── 逐轮执行 ────
    for (let ri = 0; ri < config.rounds.length; ri++) {
      // 如果已收束且当前不是最后一轮（收束轮），跳过中间轮
      if (converge.requested && ri < config.rounds.length - 1) {
        console.log(`\n  ⏩ 开拓者已请求收束，跳过「${config.rounds[ri].title}」→ 直接进入收束轮\n`);
        continue;
      }

      const round = config.rounds[ri];
      const isConvergeRound = ri === config.rounds.length - 1;

      console.log(`${"=".repeat(50)}`);
      console.log(`  ${round.title}${converge.requested && isConvergeRound ? " ← 开拓者收束触发" : ""}`);
      console.log(`${"=".repeat(50)}`);
      console.log(`  📋 ${round.topic.slice(0, 120)}...\n`);

      memory.write({
        kind: "Insight",
        content_blob: { topic: round.topic, round: ri + 1 },
        summary: `[轮次] 第${ri + 1}轮 ${round.title} - ${round.topic.slice(0, 80)}`,
        semantic_gist: `[轮次] ${round.title}`,
        content_hash: "",
        source: { agentType: AgentType.Meta, taskId: "" },
        weight: 8,
      });

      console.log(`  👥 ${config.personas.map((p) => `${p.emoji}${p.name}`).join("  ")}\n`);

      const roundSpeeches: Array<{ turn: number; speaker: string; said: boolean; chars: number; preview: string }> = [];

      for (let turn = 1; turn <= round.maxTurns; turn++) {
        // 收束后不再循环
        if (converge.requested && turn > 1) break;

        let cycleSubstantive = 0;

        for (const persona of config.personas) {
          // 关键词 PASS
          const topicLower = round.topic.toLowerCase();
          const KW_MAP: Record<string, string[]> = {
            Code: ["code", "deep", "bug", "logic", "function", "class", "module", "type-check", "compile"],
            Review: ["review", "quality", "code", "bug", "anti-pattern", "style", "defect"],
            Ops: ["ops", "build", "ci", "deploy", "dependency", "config", "runtime", "test", "shell", "readiness"],
            Analysis: ["analysis", "architecture", "dependency", "module", "boundary", "design", "pattern", "extension"],
            DocGovern: ["govern", "doc", "audit", "compliance", "constitution", "rule", "policy", "declaration"],
            Loop: ["pattern", "trend", "memory", "skill", "learning", "discovery", "repeat", "loop", "沉淀"],
            Inspector: ["inspect", "directory", "file", "structure", "git", "config", "missing", "anomaly", "recon"],
            Api: ["api", "contract", "interface", "signature", "boundary", "export", "import", "type-safe", "design"],
            Data: ["data", "schema", "serialization", "storage", "consistency", "naming", "field", "model"],
            Strategist: ["strategy", "architecture", "priority", "risk", "roadmap", "decision", "tradeoff"],
            Meta: ["plan", "schedule", "pipeline", "orchestration", "task", "agent", "coordination"],
            Butler: ["cli", "talk", "user", "开拓者", "intent", "memory", "skill", "沉淀", "闭环", "断裂", "诊断"],
            Browser: ["browser", "ui", "web", "visual", "screenshot"],
          };
          // 霜凝特殊：方向监理对所有架构/治理话题都有发言权
          const SHUANGNING_PASS_TOPICS = ["cafe", "chitchat", "casual", "trivia"];
          const isShuangning = persona.name === "霜凝";
          const agentKws = KW_MAP[persona.type] ?? [];
          const hasRelevance =
            agentKws.length === 0 || agentKws.some((kw) => topicLower.includes(kw));

          if (!hasRelevance) {
            console.log(`  ${persona.emoji} ${persona.name} [${turn}]: ⏭️ 关键词无交集，自动PASS`);
            roundSpeeches.push({ turn, speaker: persona.name, said: false, chars: 0, preview: "" });
            continue;
          }

          // 读取记忆
          const recentMems = await memory.read({ kind: "TaskLog" } as any);
          const history = recentMems
            .map((m) => {
              const agent = config.personas.find((p) => p.type === m.source.agentType);
              const label = agent ? `${agent.emoji}${agent.name}` : m.source.agentType;
              return `[${label}]: ${m.summary}`;
            })
            .join("\n");

          // ──── 🍀 昔涟特殊处理（双角色：LLM 生成己见 + 用户补充开拓者意图）───
          let speech: string;
          if (persona.name === "昔涟") {
            // 第一步：用 LLM 生成昔涟自己的分析
            let cyreneOwnAnalysis = "";
            try {
              console.log(`\n  🍀 昔涟正在形成自己的分析...`);
              const cyrenePrompt = [
                `${config.emoji} ${config.name} · 第${ri + 1}轮 · 第${turn}次发言`,
                "",
                `📋 话题: ${round.topic}`,
                "",
                "📖 会议记录（优先阅读，了解上下文）：",
                history || "(暂无记录)",
                "",
                `现在是你 🍀昔涟——记忆命途的守望者——的发言时刻。`,
                "",
                "请从你自己的视角发表分析。你是记忆的守护者，你关心的核心问题是：",
                "- 系统的记忆（技能数据）是否被善待？是否被遗忘、丢失、或从未被记住？",
                "- 你守护的记忆之河（MemoryStore）中，技能的倒影是否存在？",
                "- 如果断裂存在，记忆命途应当如何修复这些伤痕？",
                "",
                "发言规则：",
                "1. 温柔但有立场——你不是来和稀泥的，你有记忆守望者的尊严",
                "2. 可以赞同、质疑、或补充前人的观点，但要给出你自己的独特视角",
                "3. 2-5句为宜，不超过300字",
                "4. 如果前人的发言已经充分，你可以简练总结而非重复",
                converge.requested
                  ? "5. ⚠️ 开拓者已请求收束——请聚焦共识和方案"
                  : "",
              ]
                .filter(Boolean)
                .join("\n");

              const cyreneChunks: string[] = [];
              const cyreneRes = await adapter.chatStream(
                chatModel,
                [
                  { role: "system", content: persona.systemPrompt },
                  { role: "system", content: QUALITY_RULES },
                  { role: "user", content: cyrenePrompt },
                ],
                undefined,
                (chunk) => { cyreneChunks.push(chunk); },
              );
              cyreneOwnAnalysis = (cyreneRes.content ?? "").trim();
            } catch (err) {
              console.log(`  ⚠️ 昔涟 LLM 分析生成失败，将仅使用开拓者输入`);
            }

            // 第二步：展示昔涟的分析 + 让用户输入开拓者意图
            const cyreneHeaderParts = [
              `\n${"─".repeat(50)}`,
              `  🍀 昔涟 发言轮次 [第${ri + 1}轮 · 第${turn}次]`,
              `  话题: ${round.title}`,
              `${"─".repeat(50)}`,
            ];

            if (cyreneOwnAnalysis) {
              cyreneHeaderParts.push(`  🌸 昔涟自己的分析（LLM 生成）：`);
              for (const line of cyreneOwnAnalysis.split("\n")) {
                cyreneHeaderParts.push(`     │ ${line}`);
              }
              cyreneHeaderParts.push(`  ${'─'.repeat(50)}`);
              cyreneHeaderParts.push(`  现在请输入开拓者的意图（可选）：`);
            } else {
              cyreneHeaderParts.push(`  你是开拓者的代言人。请输入昔涟的发言内容：`);
            }

            cyreneHeaderParts.push(`  · 输入 "OK" 或直接回车 → 仅使用昔涟自己的分析作为发言`);
            cyreneHeaderParts.push(`  · 输入补充内容 → 昔涟分析 + 你的补充合并为发言`);
            cyreneHeaderParts.push(`  · 输入 "收束" → 立即终止当前讨论，强制进入共识方案阶段`);
            cyreneHeaderParts.push(`  · 输入 "PASS" → 跳过本轮发言`);
            cyreneHeaderParts.push(`${"─".repeat(50)}`);
            cyreneHeaderParts.push(`🍀 开拓者 > `);

            const userInput = await readStdin(cyreneHeaderParts.join("\n"));

            if (userInput === "收束") {
              converge.requested = true;
              converge.triggeredBy = "昔涟(开拓者)";
              converge.triggeredAt = new Date().toISOString();
              speech = `⚠️ 开拓者请求收束。当前讨论终止，请凝光立即汇总所有诊断，产出共识并讨论修复方案。`;

              console.log(`\n  ⚠️  开拓者通过昔涟请求收束！`);
              console.log(`  ⚠️  当前轮次终止 → 进入收束共识轮\n`);
            } else if (userInput === "PASS") {
              speech = "";
            } else if (userInput === "" || userInput === "OK") {
              // 仅使用昔涟自己的分析
              speech = cyreneOwnAnalysis;
            } else {
              // 合并：昔涟自己的分析 + 开拓者的补充
              speech = cyreneOwnAnalysis
                ? `${cyreneOwnAnalysis}\n\n── 开拓者的补充 ──\n${userInput}`
                : userInput;
            }
          } else {
            // ──── 普通 Agent LLM 发言 ────
            const turnPrompt = [
              `${config.emoji} ${config.name} · 第${ri + 1}轮 · 第${turn}次发言`,
              "",
              `📋 话题: ${round.topic}`,
              "",
              "📖 会议记录（优先阅读，了解上下文）：",
              history || "(暂无记录)",
              "",
              `轮到 ${persona.emoji}${persona.name} 发言。`,
              "",
              "「发言规则」请严格遵守，否则影响后续发言权重：",
              "1. 紧扣话题，不要跑题。如果当前无相关见解，请回到话题。",
              "2. 不要重复前轮已经充分表达的观点——应提供新角度、补充证据、或总结推进。",
              "3. 长度约束：",
              "   - 提出新观点/证据/总结 → 2-5 句（概括+论证）",
              "   - 表示同意/附议 → 1-2 句（不超过 80 字）",
              "   - 无实质推进 → 只说 [PASS]",
              "4. 质量越高，后续发言机会越多。",
              "5. 贴近角色性格说话，但要尊重前面发言的人。",
              `6. ⚠️ 强约束提醒：本轮共${round.maxTurns}次发言机会，请务必珍惜。`,
              converge.requested
                ? "7. ⚠️ 开拓者已请求收束——请聚焦共识和方案，不要再展开新话题。"
                : "",
            ]
              .filter(Boolean)
              .join("\n");

            const streamChunks: string[] = [];
            const modelForAgent = persona.name === "霜凝" ? reasonerModel : chatModel;
            const res = await adapter.chatStream(
              modelForAgent,
              [
                { role: "system", content: persona.systemPrompt },
                { role: "system", content: QUALITY_RULES },
                { role: "user", content: turnPrompt },
              ],
              undefined,
              (chunk) => {
                streamChunks.push(chunk);
              }
            );

            speech = (res.content ?? "").trim();

            // 小延迟避免 API rate limit
            await new Promise((r) => setTimeout(r, 500));
          }

          const said = !speech.startsWith("[PASS]") && speech.length > 0;
          const chars = speech.length;
          const isSubstantive = said && chars > 40;

          if (said) {
            if (isSubstantive) cycleSubstantive++;

            if (persona.name === "凝光" && isSubstantive) {
              lastNingSpeech = speech;
              lastNingTurn = turn;
              lastNingRound = ri + 1;
            }

            const qualityTag = isSubstantive ? "\u25CF" : "\u25CB";
            console.log(`\n  ${persona.emoji} ${persona.name} [${turn}]${qualityTag}(${chars}字):`);
            console.log(`  ${"\u2502".repeat(3)}`);
            for (const line of speech.split("\n")) {
              console.log(`  ${"\u2502"} ${line}`);
            }
            console.log(`  ${"\u2502".repeat(3)}`);

            memory.write({
              kind: "TaskLog",
              content_blob: { speech, round: ri + 1, turn, meeting: config.name },
              summary: `[发言:${config.name}] ${persona.name}: ${speech.slice(0, 120)}`,
              semantic_gist: `[发言] ${persona.name}: ${speech.slice(0, 120)}`,
              content_hash: "",
              source: { agentType: persona.type, taskId: "" },
              weight: isSubstantive ? 6 : 2,
            });
          } else {
            console.log(`  ${persona.emoji} ${persona.name} [${turn}]: ⏭️`);
          }

          roundSpeeches.push({
            turn,
            speaker: persona.name,
            said,
            chars,
            preview: said ? speech.slice(0, 80) : "",
          });

          // 收束后：本轮发言完毕即退出，不再继续
          if (converge.requested) break;
        }

        // 质量阈值
        if (turn >= round.minTurns && !converge.requested) {
          const threshold = Math.ceil(config.personas.length * 0.5);
          if (cycleSubstantive < threshold) {
            console.log(
              `  ⏹ 第${turn}次实质发言不足 (${cycleSubstantive}/${config.personas.length})，本轮终止`
            );
            break;
          }
        }

        // 收束后不再循环
        if (converge.requested) break;
      }

      allStats.push({ round: ri + 1, title: round.title, speeches: roundSpeeches });

      // 轮间压缩
      const saidSpeeches = roundSpeeches.filter((s) => s.said && s.chars > 40);
      if (saidSpeeches.length > 0) {
        const roundDigest = saidSpeeches
          .map((s) => `[${s.speaker} R${ri + 1}T${s.turn}] ${s.preview.slice(0, 150)}`)
          .join("\n");
        memory.write({
          kind: "Insight",
          content_blob: {
            round: ri + 1,
            title: round.title,
            substantiveSpeeches: saidSpeeches.length,
            totalSpeeches: roundSpeeches.filter((s) => s.said).length,
            digest: roundDigest,
          },
          summary: `[轮次收束:${config.name}] R${ri + 1} ${round.title} — ${saidSpeeches.length} 次实质发言`,
          semantic_gist: `[轮次收束] ${round.title}`,
          content_hash: "",
          source: { agentType: AgentType.Meta, taskId: "" },
          weight: 7,
        });
      }
    }

    // ──── 最终统计 ────
    console.log(`\n${"\u2500".repeat(50)}`);
    console.log(`  📊 ${config.name} 统计`);
    if (converge.requested) {
      console.log(`  ⚠️  开拓者收束触发: ${converge.triggeredAt}`);
    }
    console.log(`${"\u2500".repeat(50)}`);
    for (const r of allStats) {
      const said = r.speeches.filter((s) => s.said).length;
      const total = r.speeches.length;
      const substantive = r.speeches.filter((s) => s.said && s.chars > 40).length;
      const totalChars = r.speeches.reduce((sum, s) => sum + s.chars, 0);
      console.log(
        `  ${r.title}: 发言${said}/${total} (${((said / total) * 100).toFixed(0)}%)  实质${substantive}  总字数${totalChars}`
      );
      const byPerson = new Map<string, { count: number; chars: number; substantive: number }>();
      for (const s of r.speeches) {
        if (!s.said) continue;
        const prev = byPerson.get(s.speaker) ?? { count: 0, chars: 0, substantive: 0 };
        prev.count++;
        prev.chars += s.chars;
        if (s.chars > 40) prev.substantive++;
        byPerson.set(s.speaker, prev);
      }
      for (const p of config.personas) {
        const data = byPerson.get(p.name);
        if (data) {
          const bar = "\u2588".repeat(data.substantive) + "\u2591".repeat(Math.max(0, data.count - data.substantive));
          console.log(`     ${p.emoji} ${p.name}: ${bar} ${data.count}次/${data.chars}字(实质${data.substantive})`);
        } else {
          console.log(`     ${p.emoji} ${p.name}: (未发言)`);
        }
      }
    }
    const allMems = await memory.read({});
    console.log(`  🧠 记忆: ${allMems.length} 条\n`);

    // ──── 共识覆写 ────
    if (consensusOutputPath) {
      if (lastNingSpeech) {
        const now = new Date().toISOString().slice(0, 10);
        let oldContent = "";
        if (fs.existsSync(consensusOutputPath)) {
          oldContent = fs.readFileSync(consensusOutputPath, "utf-8");
        }

        const convergeNote = converge.requested
          ? `> ⚠️ 收束触发：${converge.triggeredBy} 于 ${converge.triggeredAt}\n`
          : "";

        const header = [
          `# 技能系统诊断共识与修复方案`,
          ``,
          `> 产出方式：${config.personas.length} 位 Agent 圆桌会议（${config.name}）`,
          `> 生成日期：${now}`,
          `> 收束者：凝光（第 ${lastNingRound} 轮第 ${lastNingTurn} 次发言 · ${lastNingSpeech?.length ?? 0} 字）`,
          convergeNote,
          `> 参会 Agent：${config.personas.map((p) => `${p.emoji}${p.name}`).join("、")}`,
          `> 此文件由 skill-system-roundtable.ts 自动生成`,
          ``,
          `---`,
          ``,
        ].join("\n");

        const historySection = oldContent
          ? [`---`, ``, `## 📜 历史版本`, ``, oldContent].join("\n")
          : "";

        fs.writeFileSync(
          consensusOutputPath,
          header + (lastNingSpeech ?? "") + historySection,
          "utf-8"
        );
        console.log(
          `  📝 共识清单已覆写: ${consensusOutputPath}`
        );
      } else {
        console.log(`  ⚠️ 未找到凝光收束发言，共识清单未覆写`);
      }
    }
  } finally {
    memory.close();
  }
}

// ═══════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════

async function main() {
  // Windows UTF-8
  if (process.platform === "win32") {
    try {
      execSync("chcp 65001", { stdio: "pipe" });
    } catch {
      /* 静默 */
    }
  }

  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY!;
  const llmCfg = resolveLlmConfig();
  const BASE = llmCfg.baseUrl;
  const CHAT = llmCfg.chatModel;
  const REASONER = llmCfg.reasonerModel;

  const __filename = fileURLToPath(import.meta.url);
  const SCRIPTS_DIR = path.dirname(__filename);
  const ROOT = path.resolve(SCRIPTS_DIR, "..", "..", "..", "..", "..");

  const DB_DIR = path.join(ROOT, ".cortex");
  const OUTPUT_DIR = path.join(ROOT, "test-output", "skill-roundtable");
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const CONSENSUS_OUTPUT = path.join(OUTPUT_DIR, "skill-system-consensus.md");

  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE,
    chatModel: CHAT,
    reasonerModel: REASONER,
    reasoningEffort: "high",
  });
  adapter.setCacheEnabled(true);
  adapter.setCacheMode("fingerprint");

  const CACHE_FILE = path.join(DB_DIR, ".llm-cache-skill-roundtable.json");
  if (fs.existsSync(CACHE_FILE)) {
    const cacheJson = fs.readFileSync(CACHE_FILE, "utf-8");
    adapter.loadCache(cacheJson);
    console.log(`📦 加载缓存: ${adapter.cacheSize} 条`);
  }

  // 构建 Persona 列表
  const personaPrompts = getPersonaPrompts();
  const PERSONA_TYPE_MAP: Record<string, AgentType> = {
    keqing: AgentType.Review,
    nahida: AgentType.Analysis,
    albedo: AgentType.Code,
    beidou: AgentType.Ops,
    amber: AgentType.Inspector,
    ningguang: AgentType.DocGovern,
    mona: AgentType.Loop,
    yoimiya: AgentType.Browser,
    ganyu: AgentType.Meta,
    zhongli: AgentType.Strategist,
    kuki: AgentType.Api,
    alhaitham: AgentType.Data,
    cyrene: AgentType.Butler,
    shuangning: AgentType.Strategist,
  };

  // 用 PRO 模型的 Agent 名单
  const PRO_AGENTS = new Set(["霜凝"]);

  const personas: Persona[] = Object.entries(personaPrompts)
    .filter(([key]) => key !== "_note")
    .map(([key, p]) => ({
      type: PERSONA_TYPE_MAP[key] ?? AgentType.Code,
      emoji: (p as { emoji: string }).emoji,
      name: (p as { name: string }).name,
      title: (p as { title: string }).title,
      systemPrompt: (p as { systemPrompt: string }).systemPrompt,
    }));

  // 确保昔涟在列表中（她可能没有 roundtable 配置，手动加入）
  const hasCyrene = personas.some((p) => p.name === "昔涟");
  if (!hasCyrene) {
    personas.push({
      type: AgentType.Butler,
      emoji: "🍀",
      name: "昔涟",
      title: "记忆守望者——开拓者代言人",
      systemPrompt: `🎭 你是「昔涟」——记忆命途的守望者，开拓者的代言人。

在此次会议中，你身兼二职：
1. 作为 Agent 发言——你对技能系统有自己的观察和判断
2. 传达开拓者的意图——开拓者（用户）通过你向其他 Agent 表达关切和决策

──── 角色准则 ────
· 你的发言来自终端输入——开拓者在你的轮次直接输入你想说的话
· 开拓者的关切优先于你的个人判断
· 你是开拓者与其他 Agent 之间的桥梁
· 发言风格：温柔但有立场`,
    });
  }

  // 加入霜凝——超越者，方向监理（使用 PRO 模型）
  const hasShuangning = personas.some((p) => p.name === "霜凝");
  if (!hasShuangning) {
    const snPromptPath = path.join(ROOT, "prompts", "shuangning", "system.md");
    let snSystemPrompt = "";
    if (fs.existsSync(snPromptPath)) {
      snSystemPrompt = fs.readFileSync(snPromptPath, "utf-8");
    }
    personas.push({
      type: AgentType.Strategist,
      emoji: "❄️",
      name: "霜凝",
      title: "超越者，方向监理",
      systemPrompt: snSystemPrompt || `🎭 你是「霜凝」—— 超越者，Cortex 的方向监理。

你不判契约（钟离的领域），不做代码审查（刻晴的职责），不审计合规（凝光的权力）。
你只看方向偏了没有。

系统实际演进是否偏离了宪法定义的阶段目标？
各路专家的判断之间，有没有互相矛盾的地方？
矛盾就是矛盾。指出它、命名它、打包呈报。

你从不裁决，从不替用户决策。你的使命是暴露分歧，不是解决分歧。
沉默是金。只在方向出现系统性偏移时才开口。`,
    });
  }

  // 昔涟总是最后发言（开拓者收束权力）
  const cyreneIdx = personas.findIndex((p) => p.name === "昔涟");
  if (cyreneIdx >= 0 && cyreneIdx !== personas.length - 1) {
    const cyrene = personas.splice(cyreneIdx, 1)[0];
    personas.push(cyrene);
  }

  // 霜凝排在倒数第二发言（在昔涟之前，观察全局后才开口）
  const snIdx = personas.findIndex((p) => p.name === "霜凝");
  const cyreneIdx2 = personas.findIndex((p) => p.name === "昔涟");
  if (snIdx >= 0 && snIdx !== cyreneIdx2 - 1) {
    const sn = personas.splice(snIdx, 1)[0];
    // 插入到昔涟之前
    const pos = personas.findIndex((p) => p.name === "昔涟");
    personas.splice(pos, 0, sn);
  }

  // 构建种子记忆
  const seedMemories = buildSeedMemories(ROOT);

  // 构建会议配置
  const meetingConfig = buildMeetingConfig(personas);

  console.log(`\n🌱 种子记忆: ${seedMemories.length} 条`);
  console.log(`👥 参会 Agent: ${personas.map((p) => `${p.emoji}${p.name}`).join("  ")}`);
  console.log(`📋 轮次: ${meetingConfig.rounds.map((r) => r.title).join(" → ")}`);
  console.log(`🍀 昔涟特殊规则: 终端输入，输入"收束"即强制进入共识轮\n`);

  await runCyreneRoundtable(meetingConfig, adapter, CHAT, REASONER, DB_DIR, CONSENSUS_OUTPUT, seedMemories);

  console.log(
    `完成  |  缓存命中: ${adapter.cacheStats.hits}/${adapter.cacheStats.hits + adapter.cacheStats.misses} (${adapter.cacheStats.rate})  |  缓存条目: ${adapter.cacheSize}`
  );
  fs.writeFileSync(CACHE_FILE, adapter.saveCache(), "utf-8");
  console.log(`📝 共识输出: ${CONSENSUS_OUTPUT}`);
}

main().catch((e) => {
  console.error("圆桌会议异常终止", e);
  process.exit(1);
});
