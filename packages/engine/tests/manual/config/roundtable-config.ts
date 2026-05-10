/**
 * 圆桌会议配置 —— Persona 定义与共识会议引擎
 *
 * Persona 性格设定从 persona-prompts.json 读取（JSON 可热更，无需编译）。
 * 每次验证审视后，audit-loader.ts 从报告目录提取最新事实数据注入 systemPrompt。
 *
 * 用法: 由 conversation-*.ts 脚本 import 使用。
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { AgentType, MemoryType } from "@cortex/shared";
import type { LlmAdapter } from "../../../src/llm-adapter";
import { MemoryStore } from "../../../src/memory-store";
import personaPrompts from "./persona-prompts.json" assert { type: "json" };

// ═══════════════════════════════════════════════
// JSON → Persona 类型映射（agent key → AgentType）
// ═══════════════════════════════════════════════

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
  thoma: AgentType.Butler,
};

function buildPersonas(prompts: Record<string, { emoji: string; name: string; title: string; systemPrompt: string } | string>): Persona[] {
  return Object.entries(prompts)
    .filter(([key]) => key !== "_note")
    .map(([key, p]) => ({
      type: PERSONA_TYPE_MAP[key] ?? AgentType.Code,
      emoji: (p as { emoji: string }).emoji,
      name: (p as { name: string }).name,
      title: (p as { title: string }).title,
      systemPrompt: (p as { systemPrompt: string }).systemPrompt,
    }));
}

// ═══════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════

export interface Persona {
  type: AgentType;
  emoji: string;
  name: string;
  title: string;
  systemPrompt: string;
}

export interface RoundConfig {
  title: string;
  minTurns: number;
  maxTurns: number;
  topic: string;
}

export interface MeetingConfig {
  name: string;
  emoji: string;
  background: string;
  rounds: RoundConfig[];
  personas: Persona[];
}

// ═══════════════════════════════════════════════
// 共识校验：已确认闭合项（地面真相基准线）
// 由各 Persona 的 systemPrompt 和验证报告共同维护，每次修复后更新。
// runMeeting 末尾会校验共识清单是否错误地包含了这些项。
// ═══════════════════════════════════════════════

interface ClosedItem {
  /** 关键字，用于在共识清单中匹配 */
  keyword: string;
  /** 排除关键字——如果同时匹配到 excludeIf，说明是引用而非误入（如 "node.failed" 匹配 "observer" 不算违规） */
  excludeIf?: string;
  /** 验证者 */
  confirmedBy: string;
  /** 修复描述 */
  description: string;
}

const CONFIRMED_CLOSED: ClosedItem[] = [
  // Scheduler 层修复
  { keyword: "双重复发", confirmedBy: "刻晴、凝光", description: "scheduler node.failed 去重 + node.complete 守卫" },
  { keyword: "node.failed", excludeIf: "observer", confirmedBy: "刻晴、凝光", description: "scheduler node.failed 去重" },
  { keyword: "claimedBy", excludeIf: "验证", confirmedBy: "凝光", description: "scheduler claimedBy invariant observer 化" },
  // MemoryStore 层修复
  { keyword: "静默吞噬", confirmedBy: "刻晴、阿贝多、凝光", description: "MemoryStore observer+console 双通道" },
  { keyword: "_saveDb", excludeIf: "验证", confirmedBy: "阿贝多", description: "MemoryStore _saveDb try-catch + observer" },
  { keyword: "_deserializeRow", excludeIf: "防JSON", confirmedBy: "阿贝多", description: "MemoryStore JSON.parse 防护" },
  { keyword: "_sqlRead", confirmedBy: "凝光", description: "MemoryStore _sqlRead observer 迁移" },
  // Agent 层修复
  { keyword: "4个继承BaseAgent", confirmedBy: "刻晴", description: "Agent 层继承已闭合" },
  { keyword: "5个独立实现", confirmedBy: "刻晴", description: "Agent 层继承已闭合" },
  { keyword: "整体替换", confirmedBy: "刻晴", description: "Agent 层继承已闭合" },
  // 工程化修复
  { keyword: "lint脚本指定目录", confirmedBy: "北斗、安柏", description: "eslint 配置已就位" },
  { keyword: "shared编译通过", confirmedBy: "北斗", description: "shared 编译通过" },
  { keyword: "15个文件全部v1.1编译", confirmedBy: "北斗", description: "shared 编译通过" },
];

// ═══════════════════════════════════════════════
// 审视共识会议配置（2026-05-04 修复验证审视后）
// ═══════════════════════════════════════════════

export const SHENSHI_CONFIG: MeetingConfig = {
  name: "审视共识会议", emoji: "\u{1F50D}",
  background: `「Cortex 修复验证审视 · 第二轮共识会议」

2026年5月4日，Cortex 完成了首轮修复验证审视——7 位 Agent 验证了 P0-P3 共 30 项修复。
验证结果：24 项已完成、3 项部分完成、3 项未开始（整体符合预期）。

现在，审视委员会（6 位 Agent）再次召集，进行第二轮圆桌会议。
目标：基于修复后的代码实况，产出新版共识修复清单——标注哪些已闭合、哪些仍需投入、哪些新问题浮现。

制度：审视共识会议——四轮发言，强约束轮次，凝光最终收束。
会议模式：已闭合确认 → 修复陈述 → 交叉验证 → 凝光收束全员签署
每轮硬顶 3 次发言机会，质量不足则提前终止。`,

  rounds: [
    {
      title: "第零轮 · 已闭合项确认",
      minTurns: 1,
      maxTurns: 2,
      topic: `在讨论新问题之前，先建立地面真相基准线。

请每位 Agent 根据自己亲手的验证结果，逐一确认哪些修复项已经确定闭合。
要求：
1. 逐项列出你亲手验证过的已闭合项（具体到文件/函数级别）
2. 如果某项多人确认已闭合，说明 ✅ 并标注验证者
3. 如果某项你只是"听说闭合了"但未亲手验证，标注 ⚠️ "未亲手验证"
4. 第零轮的陈述将作为后续讨论的地面真相基准——后续轮次不应将已闭合项重新当成待修复项

凝光的任务：倾听并记录各 Agent 确认的已闭合项，这些项将在最终清单中归入 ✅ 已闭合节，不得出现在 P0-P3 修复清单中。`,
    },
    {
      title: "第一轮 · 修复验证陈述",
      minTurns: 2,
      maxTurns: 3,
      topic: `请结合你自己的验证结果，陈述你发现的 TOP 3 关键发现。
重点：哪些修复闭合得很好，哪些修复未完成或有残留。
如果你发现了新问题（修复引入的副作用、验证过程中暴露的隐藏债务），务必提出来。

⚠️ 重要约束：第零轮已确认闭合的项，本轮不应再作为"未修复"提出。
如果你认为某已闭合项仍有残留，必须提供新的具体证据（新发现的代码路径、新暴露的边界条件），而不是重复已知信息。

注意别人说了什么——如果多人已经说了同一个问题，请从你的不同视角补充，不要重复。`,
    },
    {
      title: "第二轮 · 交叉验证与重点识别",
      minTurns: 2,
      maxTurns: 3,
      topic: `基于前两轮的陈述进行交叉分析：
1. 哪些问题被多人独立发现——这意味着共识强度高，应升级优先级
2. 哪些问题是同一问题的不同表现——应合并为一条修复项
3. 是否有冲突的发现？（如某人认为已闭合而另一人发现残留）
4. 是否遗漏了重大问题？
5. 检查清单中被标 [x] 的项是否真的完成了——而不是改了个标记或加了行注释就算完

目标：深化分析，不展开新话题。`,
    },
    {
      title: "第三轮 · 凝光收束与全员签署",
      minTurns: 2,
      maxTurns: 3,
      topic: `基于前三轮的所有陈述和交叉分析，凝光现在收束共识。

凝光：请产出完整更新版修复优先级清单，格式如下：

## 审视共识修复清单（第二轮）

### P0 立即修复（阻断级——不修则下阶段无法推进）
- [ ] ...

### P1 高优先（Core-2 启动前必须完成）
- [ ] ...

### P2 重要（Core-2 期间修复）
- [ ] ...

### P3 改善（可延后但不应遗忘）
- [ ] ...

### ✅ 已闭合（从清单移除——第零轮已确认 + 代码级验证）
- ✅ scheduler node.failed 去重 + node.complete 守卫（刻晴、阿贝多验证：三条路径互斥，_dispatchNode 底部统一发射）
- ✅ MemoryStore _saveDb try-catch + observer.emit('memory.persist_failed')（阿贝多、凝光验证：observer+console 双通道）
- ✅ MemoryStore _deserializeRow JSON.parse try-catch 防护（阿贝多、刻晴验证：null 返回 + 调用侧 null 检查）
- ✅ MemoryStore _sqlRead observer 迁移（凝光验证：catch 中 observer.emit('memory.sql_degraded')）
- ✅ scheduler claimedBy invariant observer 化（阿贝多验证：console.error → observer.emit('scheduler.invariant_violation')）
- ✅ Agent 层继承已闭合（刻晴验证）
- ✅ eslint/tsconfig 已就位（安柏、北斗验证）
- ✅ shared 编译通过（北斗验证）
- ✅ shared 四域拆分（纳西妲、安柏验证）
- ✅ test.html 已迁 webui/（安柏验证）
- ✅ tmp/ 已进 gitignore（安柏验证）
- （第零轮中各 Agent 确认的其他已闭合项）

⚠️ 排除规则（必须遵守）：
- 上述 ✅ 已闭合节中的任何项目，禁止出现在 P0/P1/P2/P3 修复清单中
- 如果某 Agent 在讨论中提到了已闭合项，那是对历史上下文的引用——不要将其误解为当前仍需修复
- 你的 P0-P3 清单只能包含真正剩余的待修复项

你的清单必须覆盖所有 Agent 的关键发现——不允许有人的核心发现被遗漏。
定级原则：P0=阻断（数据静默损坏/observer缺失/CI缺失）；P1=高风险（.env冲突/browser-e2e引用未更新）；P2=可规划修复；P3=改善项。

其他 Agent：审阅凝光的清单，确认你的关键发现是否被正确记录和定级。
如有遗漏或定级错误，必须在下一轮中指出。
如无异议，签署「确认」。最终产出一份全员签署的新版审视共识修复清单。`,
    },
  ],

  personas: buildPersonas(personaPrompts),
};

// ═══════════════════════════════════════════════
// 三轮代码审阅圆桌配置（2026-05-11 宪法 v2.5 入宪）
// ═══════════════════════════════════════════════

export const CODE_REVIEW_ROUNDTABLE: MeetingConfig = {
  name: "三轮代码审阅圆桌", emoji: "\u{1F9EA}",
  background: `「Cortex 自审视 · 三轮代码审阅圆桌」

2026年5月11日，Cortex 完成了软约束自由审视——7 位 Agent 在代码库中自由探索，产出 8 份报告。
经过根因归簇分析，206+ 项发现跨报告去重后归为 6 个根因簇。

现在，三代十位审视委员（探索者 + 圆桌参与者 + 记录员）全员入席。
这是宪法 v2.5 确立的三轮圆桌代码审阅标准流程——不是修复清单验证，而是根因导向的深度讨论。

制度：三轮圆桌代码审阅（宪法 v2.5 §十三）
- 每轮每人 5-7 次发言机会
- 每轮必须收束结论（凝光汇总，全员签署）
- 所有 10 位 Agent 作为圆桌主体参与——你们是这里面的主体，不是工具
- 甘雨从秘书转为平权参与者，托马从旁观转为记录员
- DeepSeek 4.1 多模态能力（2026-06 发布）纳入第三轮讨论

讨论素材（已全部注入 MemoryStore）：
- 根因归簇分析报告（root-cause-cluster-analysis.md）：6 个根因簇，186 条具体发现
- 8 份 Agent 审视报告：刻晴（质量侦察）、纳西妲（架构分析）、凝光（治理审计）、阿贝多（核心层审查）、莫娜（模式发现）、安柏（侦察）、北斗（工程诊断）
- 宪法 v2.5 全文（含新增自审视权限例外 §5.1.1、DeepSeek 4.1 多模态预留）`,

  rounds: [
    {
      title: "第一轮 · 持久化链路与状态机——区分「本轮必修」vs「Core-2 再修」",
      minTurns: 5,
      maxTurns: 7,
      topic: `【聚焦根因簇 A（持久化链路防御不足）+ B（状态机流转不完整）】

请每位委员基于自己的审视经验，讨论以下问题的修复策略：

簇 A：持久化链路防御不足
- MemoryStore.write() 缺少 _lifecycle 守卫——刻晴标记为 🔴 致命（close 期间写入：内存有、DB 无、flush 跳过）
- write-through 模式缺少事务包裹——阿贝多标记为 🟠
- ID 生成使用 Date.now() + 计数器——毫秒级时序竞态——阿贝多标记为 🟠
- try-catch 风格发散（28+4+5+2 处）——莫娜标记为 4 种变体并存

簇 B：状态机流转不完整
- AgentPool.destroy() 绕过 setStatus() 直写 Map——刻晴标记为 🟠 硬伤
- setStatus() 返回 void——非法流转时调用方无法感知——阿贝多标记为 🟠
- complete() 中 results 与 claimedBy 边界不同步——阿贝多标记为 🟠

讨论目标：
1. 逐项判断：哪些必须本轮立即修复（Core-1 内闭），哪些可以推迟到 Core-2
2. 评估每项修复的代价与风险（改动的文件数、影响面、回归风险）
3. 收束为「本轮必修清单」——不超过 5 项

收束要求：本轮结束时凝光输出「第一轮收束结论」，列出本轮必修项及其排期。`,
    },
    {
      title: "第二轮 · 工程债务与可观测管道——评估偿还优先级",
      minTurns: 5,
      maxTurns: 7,
      topic: `【聚焦根因簇 C（可观测管道覆盖不全）+ D（基础设施/工程债务）】

请每位委员基于自己的经验讨论：

簇 C：可观测管道覆盖不全
- ButlerAgent._onNormal 空吞 NORMAL 优先级事件——刻晴标记为 🔴（已修复：移除 NORMAL 订阅 + 删除空方法）
- observer.emit memory 域 6 次事件无消费者——莫娜标记为 🟡

簇 D：基础设施/工程债务
- engine 23 源文件无同目录 __tests__/——纳西妲标记 🟡
- llm-adapter + toolkit 无熔断降级——纳西妲标记 🟡
- infra.ts 6 子域混杂——纳西妲标记 🟡
- test-tmp.txt 未被 .gitignore——安柏标记 🟡
- shared/dist/__tests__/ 测试产物混入构建——安柏标记 🟡
- 根目录 webui/ 与 doc-govern/ 目录整理——安柏标记

讨论目标：
1. 评估哪些工程债务必须在 Core-2 启动前偿还（否则 Core-2 开发受阻）
2. 哪些可以等 Core-2 中逐步解决
3. 特别注意：纳西妲提到的「llm-adapter + toolkit 无熔断」——DeepSeek 4.1 发布后调用量将暴增，没有熔断是单点故障

收束要求：本轮结束时凝光输出「第二轮收束结论」，更新优先级矩阵。`,
    },
    {
      title: "第三轮 · 模式债务 + DeepSeek 4.1 多模态——宪法演进讨论",
      minTurns: 5,
      maxTurns: 7,
      topic: `【聚焦根因簇 E（代码模式债务）+ F（治理合规偏差，已归因）+ DeepSeek 4.1 多模态预留】

簇 E：代码模式债务（莫娜发现）
- Agent 构造同构模式 6 次重复——analysis/code/loop/ops/review/doc-govern-agent.ts
- getMemoryQuery() 4 次重复结构
- 建议：提取 SimpleAgent 工厂函数——但模式债不影响功能，可以推迟

簇 F：治理合规偏差（凝光审计，已归因）
- 5 项文档-代码权限偏差 D-01~D-05——宪法 v2.5 §5.1.1 已正式确认：不是 bug，是元系统自审视的天然需求

DeepSeek 4.1 多模态预留（2026-06 发布）
- BrowserAgent 将获得截图→视觉理解闭环
- InspectorAgent 可分析设计稿/架构图直译
- PipelineObserver 事件 schema 需预留 payloadType: "text" | "image" | "audio"
- Agent 工具调用协议需支持 image 类型输入参数

讨论目标：
1. 簇 E 的模式债：现在提取 SimpleAgent 还是等 Core-2 新 Agent 加入后再重构？
2. 簇 F：宪法 v2.5 已修正，确认凝光的审计结论被正确消化
3. DeepSeek 4.1：哪些预埋伏笔必须现在就埋（否则发版后再改宪法就是 breaking change）？
4. 宪法中还有哪些未提及的议题需要在这次讨论中提出？

收束要求：本轮结束时凝光输出「第三轮收束结论」+ 对宪法的补充建议（如有）。`,
    },
  ],

  personas: buildPersonas(personaPrompts),
};

// ═══════════════════════════════════════════════
// 发言质量规则（注入为第二层 system prompt）
// ═══════════════════════════════════════════════

export const QUALITY_RULES = `
「审视共识会议」发言质量规则（高于角色设定，全员遵守）：
1. 紧扣话题：发言内容必须与当前轮次的话题直接相关。如偏离话题，请拉回。
2. 禁止重复：不得复读前轮已充分表达的觀點。应当提供新角度、补充证据、或总结推进讨论。
3. 强约束长度：
   - 提出新观点/证据/总结 → 2-5 句（概括+论证）
   - 表示同意/附议 → 1-2 句（不应超过 80 字）
   - 无话可说/已充分讨论 → 只说 [PASS]
4. 质量权重：实质贡献越多，发言机会越多。禁止灌水消耗轮次权重。
5. 发言前先读记忆——了解别人说了什么，再决定自己要不要说、说什么。
6. 强约束提醒：本轮只有 2-3 次发言机会，每次发言都应推进共识，请务必珍惜。
7. 🔥 允许抱怨——看到烂代码、设计缺陷、迟迟不修的 bug、糊弄的修复时，可以表达不满甚至发火。但抱怨之后必须跟上实质分析（为什么烂、怎么修），纯宣泄不算贡献。刻晴的「效率太低了！」、北斗的「别整这些虚的！」都是合法的——只要后面跟着干货。`;

// ═══════════════════════════════════════════════
// 共识校验：检测已闭合项是否错误进入修复清单
// ═══════════════════════════════════════════════

function validateConsensus(filePath: string) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf-8");

  // 提取 P0 和 P1 节中的待修复项（排除历史版本区域）
  const mainContent = content.split(/## 📜 历史版本/)[0] ?? content;
  const p0p1Section = (mainContent.match(/### P0[\s\S]*?(?=### P2|### ✅|## 📜|$)/)?.[0] ?? "")
    + (mainContent.match(/### P1[\s\S]*?(?=### P2|### ✅|## 📜|$)/)?.[0] ?? "");

  const violations: Array<{ keyword: string; confirmedBy: string; description: string }> = [];

  for (const item of CONFIRMED_CLOSED) {
    if (!p0p1Section.includes(item.keyword)) continue;
    // 如果 excludeIf 也出现在同一区域，说明是引用而非违规（如 "node.failed" 出现在 "observer" 上下文中）
    if (item.excludeIf && p0p1Section.includes(item.excludeIf)) continue;
    violations.push(item);
  }

  if (violations.length > 0) {
    console.log(`\n  ───────────────────────────────────`);
    console.log(`  ⚠️  共识校验警告：${violations.length} 个已闭合项错误出现在修复清单中`);
    console.log(`  ───────────────────────────────────`);
    for (const v of violations) {
      console.log(`     ❌ "${v.keyword}" → ${v.description}（验证者：${v.confirmedBy}）`);
    }
    console.log(`  💡 原因：LLM 未遵循排除规则，将已闭合项误入 P0/P1`);
    console.log(`  💡 建议：检查 Persona 配置是否过期，或手动修正共识清单\n`);
  } else {
    console.log(`  ✅ 共识校验通过：P0/P1 中没有错误包含的已闭合项\n`);
  }
}

// ═══════════════════════════════════════════════
// 通用会议引擎
// ═══════════════════════════════════════════════

export async function runMeeting(
  config: MeetingConfig,
  adapter: LlmAdapter,
  chatModel: string,
  dbDir: string,
  consensusOutputPath?: string,
) {
  const dbPath = path.resolve(dbDir, "shared-consensus.db");

  // 清理上次会议的旧记忆，防止跨会议污染
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  // 同时清理 SQLite WAL/SHM 残留
  for (const suffix of ["-wal", "-shm"]) {
    const aux = dbPath + suffix;
    if (fs.existsSync(aux)) fs.unlinkSync(aux);
  }

  const memory = new MemoryStore();
  await memory.init(dbPath);

  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  ${config.emoji}  ${config.name}`);
    console.log(`${"=".repeat(60)}\n`);

    // 会议背景写入 Knowledge 记忆
    memory.write({
      memoryType: MemoryType.Knowledge,
      content: { background: config.background },
      summary: `[会议背景] ${config.name}: ${config.background.slice(0, 80)}`,
      agentType: AgentType.Meta,
      creatorId: "system",
      weight: 10,
    });

    const allStats: Array<{
      round: number; title: string;
      speeches: Array<{ turn: number; speaker: string; said: boolean; chars: number; preview: string }>;
    }> = [];

    for (let ri = 0; ri < config.rounds.length; ri++) {
      const round = config.rounds[ri];
      console.log(`${"=".repeat(50)}`);
      console.log(`  ${round.title}`);
      console.log(`${"=".repeat(50)}`);
      console.log(`  📋 ${round.topic.slice(0, 100)}...\n`);

      memory.write({
        memoryType: MemoryType.Knowledge,
        content: { topic: round.topic, round: ri + 1 },
        summary: `[轮次] 第${ri + 1}轮 ${round.title} - ${round.topic.slice(0, 80)}`,
        agentType: AgentType.Meta,
        creatorId: "system",
        weight: 8,
      });

      console.log(`  👥 ${config.personas.map((p) => `${p.emoji}${p.name}`).join("  ")}\n`);

      const roundSpeeches: Array<{ turn: number; speaker: string; said: boolean; chars: number; preview: string }> = [];

      // 强约束轮次：maxTurns 硬顶，质量阈值 50%
      for (let turn = 1; turn <= round.maxTurns; turn++) {
        let cycleSubstantive = 0;

        for (const persona of config.personas) {
          const recentMems = memory.read({
            memoryTypes: [MemoryType.Episodic, MemoryType.Knowledge],
            limit: 20,
          });

          const history = recentMems
            .map((m) => {
              const agent = config.personas.find((p) => p.type === m.agentType);
              const label = agent ? `${agent.emoji}${agent.name}` : m.agentType;
              return `[${label}]: ${m.summary}`;
            })
            .join("\n");

          const turnPrompt = [
            `${config.emoji} ${config.name} · 第${ri + 1}轮 · 第${turn}次发言`,
            "",
            `📋 话题: ${round.topic.slice(0, 200)}`,
            "",
            "📖 会议记录（优先阅读，了解上下文）：",
            history || "(暂无记录)",
            "",
            `轮到 ${persona.emoji}${persona.name} 发言。`,
            "",
            "「发言规则」请严格遵守，否则影响后续发言权重：",
            "1. 紧扣话题，不要跑题。如果当前无相关见解，请回到话题。",
            "2. 不要重复前轮已经充分表达的觀點——应提供新角度、补充证据、或总结推进。",
            "3. 长度约束：",
            "   - 提出新观点/证据/总结 → 2-5 句（概括+论证）",
            "   - 表示同意/附议 → 1-2 句（不超过 80 字）",
            "   - 无实质推进 → 只说 [PASS]",
            "4. 质量越高，后续发言机会越多——推进讨论者获得更多话语权。",
            "5. 贴近角色性格说话，但要尊重前面发言的人。",
            `6. ⚠️ 强约束提醒：本轮共${round.maxTurns}次发言机会，请务必珍惜，每次发言都应推进共识。`,
          ].join("\n");

          const streamChunks: string[] = [];
          const res = await adapter.chatStream(chatModel, [
            { role: "system", content: persona.systemPrompt },
            { role: "system", content: QUALITY_RULES },
            { role: "user", content: turnPrompt },
          ], undefined, (chunk) => {
            streamChunks.push(chunk);
          });

          const speech = (res.content ?? "").trim();
          const said = !speech.startsWith("[PASS]") && speech.length > 0;
          const chars = speech.length;

          // 质量判断：> 40 字视为实质贡献
          const isSubstantive = said && chars > 40;

          if (said) {
            if (isSubstantive) cycleSubstantive++;
            // 流式输出：先打印发言标头，再打印全文
            const qualityTag = isSubstantive ? "\u25CF" : "\u25CB";
            console.log(`\n  ${persona.emoji} ${persona.name} [${turn}]${qualityTag}(${chars}字):`);
            console.log(`  ${"\u2502".repeat(3)}`);
            // 全文输出（不再截断）
            for (const line of speech.split("\n")) {
              console.log(`  ${"\u2502"} ${line}`);
            }
            console.log(`  ${"\u2502".repeat(3)}`);
            memory.write({
              memoryType: MemoryType.Episodic,
              content: { speech, round: ri + 1, turn, meeting: config.name },
              summary: `[发言:${config.name}] ${persona.name}: ${speech.slice(0, 100)}`,
              agentType: persona.type,
              creatorId: persona.name,
              weight: isSubstantive ? 6 : 2,
            });
          } else {
            console.log(`  ${persona.emoji} ${persona.name} [${turn}]: ⏭️`);
          }

          roundSpeeches.push({ turn, speaker: persona.name, said, chars, preview: said ? speech.slice(0, 80) : "" });
        }

        // 强约束：质量阈值 50%——若半数以上 Agent 无实质发言，本轮提前终止
        if (turn >= round.minTurns) {
          const threshold = Math.ceil(config.personas.length * 0.5);
          if (cycleSubstantive < threshold) {
            console.log(`  ⏹ 第${turn}轮实质发言不足 (${cycleSubstantive}/${config.personas.length})，本轮终止`);
            break;
          }
        }
      }

      allStats.push({ round: ri + 1, title: round.title, speeches: roundSpeeches });
    }

    // 最终统计
    console.log(`\n${"\u2500".repeat(50)}`);
    console.log(`  📊 ${config.name} 统计`);
    console.log(`${"\u2500".repeat(50)}`);
    for (const r of allStats) {
      const said = r.speeches.filter((s) => s.said).length;
      const total = r.speeches.length;
      const substantive = r.speeches.filter((s) => s.said && s.chars > 40).length;
      const totalChars = r.speeches.reduce((sum, s) => sum + s.chars, 0);
      console.log(`  ${r.title}: 发言${said}/${total} (${((said / total) * 100).toFixed(0)}%)  实质${substantive}  总字数${totalChars}`);
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
    const allMems = memory.read({});
    console.log(`  🧠 记忆: ${allMems.length} 条\n`);

    // 共识覆写：提取凝光最终发言 → 共识清单覆写 markdown 文件
    if (consensusOutputPath) {
      const finalRound = config.rounds.length;
      const ningEpisodic = allMems.filter(
        (m: any) =>
          m.memoryType === MemoryType.Episodic &&
          m.creatorId === "凝光" &&
          m.content?.round === finalRound
      );

      // 取凝光最后一轮的最后一次实质发言
      const lastSpeech = ningEpisodic
        .sort((a: any, b: any) => (b.content?.turn ?? 0) - (a.content?.turn ?? 0))
        .find((m: any) => {
          const s = String(m.content?.speech ?? "");
          return s.length > 40 && !s.startsWith("[PASS]");
        });

      if (lastSpeech) {
        const speechText = String(lastSpeech.content.speech);
        const turnNum = lastSpeech.content.turn;
        const now = new Date().toISOString().slice(0, 10);

        // 读取旧文件内容，用于追加历史版本
        let oldContent = "";
        if (fs.existsSync(consensusOutputPath)) {
          oldContent = fs.readFileSync(consensusOutputPath, "utf-8");
        }

        // 构建新文件：新版共识 + 历史归档
        const header = [
          `# 审视共识修复清单`,
          ``,
          `> 产出方式：6 位 Agent 圆桌会议（审视共识会议 · 强约束版本）`,
          `> 生成日期：${now}`,
          `> 收束者：凝光（第 ${finalRound} 轮第 ${turnNum} 次发言 · ${speechText.length} 字）`,
          `> 参会 Agent：${config.personas.map((p) => `${p.emoji}${p.name}`).join("、")}`,
          `> 此文件由 runMeeting 自动生成，每次会议完成后覆写。旧版自动追加至「历史版本」区。`,
          ``,
          `---`,
          ``,
        ].join("\n");

        const historySection = oldContent
          ? [
              ``,
              `---`,
              ``,
              `## 📜 历史版本（自动追加，方便追溯）`,
              ``,
              `> 以下为本次会议前的内容。每次圆桌完成后，旧版自动移入此区。`,
              ``,
              oldContent,
            ].join("\n")
          : "";

        fs.writeFileSync(consensusOutputPath, header + speechText + historySection, "utf-8");
        console.log(`  📝 共识清单已覆写: ${consensusOutputPath} (${(header + speechText + historySection).length} 字符)`);
        if (oldContent) {
          console.log(`  📜 旧版已追加至「历史版本」区`);
        }

        // 共识校验：P0 修复 → 检测已闭合项是否错误进入修复清单
        validateConsensus(consensusOutputPath);
      } else {
        console.log(`  ⚠️ 未找到凝光收束发言，共识清单未覆写`);
      }
    }
  } finally {
    memory.close();
  }
}
