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
import { AgentType, LinkType, MemoryType } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
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
  zhongli: AgentType.Strategist,
  kuki: AgentType.Api,
  alhaitham: AgentType.Data,
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
  /** 稀疏注意力模式：hca=广度浅读（热身/概览轮），csa=深度窄读（讨论/收束轮）。默认 csa。 */
  queryMode?: 'hca' | 'csa';
}

export interface MeetingConfig {
  name: string;
  emoji: string;
  background: string;
  rounds: RoundConfig[];
  personas: Persona[];
}

export interface MaterialItem {
  /** 材料名称 */
  name: string;
  /** 材料描述——说明该材料的用途和在会议中的作用 */
  description: string;
  /** 来源——谁产出的这份材料 */
  source: string;
  /** 文件路径（相对于项目根目录） */
  filePath?: string;
  /** 所属阶段——该材料在会议流程的哪个阶段被使用 */
  phase: "热身" | "第一轮" | "第二轮" | "第三轮" | "第二阶段·无主题" | "全程参考";
  /** 是否必须——缺失时是否阻断会议 */
  required: boolean;
}

export interface MaterialChecklist {
  /** 清单版本 */
  version: string;
  /** 最后更新日期 */
  updatedAt: string;
  /** 材料列表 */
  items: MaterialItem[];
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
// 材料清单（2026-05-04 初版）
//
// 圆桌会议各阶段所需的材料及其来源。
// 每次圆桌启动前，由凝光按此清单校验材料是否完备——
// 缺失必需材料（required=true）则阻断会议，缺失可选材料则标记警告。
// ═══════════════════════════════════════════════

export const MATERIAL_CHECKLIST: MaterialChecklist = {
  version: "1.0",
  updatedAt: "2026-05-04",
  items: [
    {
      name: "Agent 审视报告（7 份）",
      description: "刻晴、阿贝多、纳西妲、凝光、莫娜、安柏、北斗在软约束自由审视中产出的独立审视报告，各从自己专业角度发现代码、架构、工程、治理、模式中的问题",
      source: "软约束自审视脚本（cortex-self-examination.ts --soft）",
      filePath: "test-output/self-examination-soft/",
      phase: "第一轮",
      required: true,
    },
    {
      name: "共识修复清单（上一轮）",
      description: "上一轮圆桌产出的 P0-P3 修复清单——如为首次圆桌则此项为空，视为无历史基准",
      source: "上一轮圆桌凝光收束签署",
      filePath: "test-output/self-examination/consensus-fix-list.md",
      phase: "第一轮",
      required: false,
    },
    {
      name: "根因归簇分析报告",
      description: "AI 归因分析引擎对 7 份审视报告进行跨报告去重归簇后产出的根因分析——将 206+ 项发现归为 6 个根因簇，标注每簇的发生频率、影响范围、修复成本估算",
      source: "AI 归因分析引擎（在自审视完成后自动触发）",
      filePath: "test-output/self-examination-soft/root-cause-cluster-analysis.md",
      phase: "第二阶段·无主题",
      required: true,
    },
    {
      name: "钟离战略评估报告",
      description: "钟离（StrategistAgent）在第四阶段半读取全部审视报告后产出的战略判断——架构方向、契约完整性、阶段跃迁判定、磨损预警",
      source: "钟离（StrategistAgent）· 第四阶段半战略分析",
      filePath: "test-output/self-examination-soft/zhongli-strategy-assessment.md",
      phase: "第二阶段·无主题",
      required: false,
    },
    {
      name: "宪法 v2.5 全文",
      description: "Cortex 概念顶层设计 v2.5——作为讨论的宪法基准，所有修复建议不得违宪",
      source: "docs/Cortex 概念顶层设计 v2.5.md",
      filePath: "docs/Cortex 概念顶层设计 v2.5.md",
      phase: "全程参考",
      required: true,
    },
    {
      name: "Agent 标签词汇表",
      description: "Agent 标签词汇表 v2.0——标签匹配的语法参考",
      source: "docs/core/Agent标签词汇表-v2.0.md",
      filePath: "docs/core/Agent标签词汇表-v2.0.md",
      phase: "全程参考",
      required: false,
    },
    {
      name: "意图响应体系设计",
      description: "意图响应体系设计文档——澄清层+匹配增强+模式区分的概念蓝图，供第三轮宪法演进讨论参考",
      source: "架构设计",
      filePath: "docs/core/意图响应体系设计.md",
      phase: "第三轮",
      required: false,
    },
    {
      name: "自由审视摘要",
      description: "自审视脚本自动生成的执行摘要——包含执行概况、Agent 产出明细、整体状态速览",
      source: "cortex-self-examination.ts 自动生成",
      filePath: "test-output/self-examination-soft/self-examination-summary.md",
      phase: "热身",
      required: false,
    },
  ],
};

// ═══════════════════════════════════════════════
// 审视共识会议配置（2026-05-04 修复验证审视后）
// ═══════════════════════════════════════════════

export const SHENSHI_CONFIG: MeetingConfig = {
  name: "审视共识会议", emoji: "\u{1F50D}",
  background: `「Cortex 审视共识会议」

审视委员会召集，基于当前代码库实况进行圆桌讨论。
目标：产出共识修复清单——标注已闭合项、仍需投入项、新浮现问题。

制度：审视共识会议——四轮发言，强约束轮次，凝光最终收束。
会议模式：已闭合确认 → 修复陈述 → 交叉验证 → 凝光收束全员签署
每轮硬顶发言机会，质量不足则提前终止。

⚠️ 所有事实应来自本轮的审视报告和各 Agent 的亲手验证——禁止引用历史记忆。`,

  rounds: [
    {
      title: "第零轮 · 已闭合项确认",
      minTurns: 1,
      maxTurns: 2,
      queryMode: "hca",
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
      queryMode: "csa",
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
      queryMode: "csa",
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
      queryMode: "csa",
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
- （第零轮中各 Agent 亲手验证的已闭合项——具体条目见第零轮会议记录）

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
      queryMode: "csa",
      topic: `【聚焦根因簇 A（持久化链路防御不足）+ B（状态机流转不完整）】

⚠️ 约束：这是「分类决策」会议，不是「架构设计」会议。每个发言必须给出明确的「必修/延后」判断，
禁止提出新的架构方案或设计模式——如 write-guard 模式、StateGuard 框架、epoch 纪元锁等都不需要在本轮讨论。

待分类项：
簇 A：持久化链路防御不足
- A1. MemoryStore.write() 缺少 _lifecycle 守卫——刻晴标记为 🔴 致命（close 期间写入：内存有、DB 无、flush 跳过）
- A2. write-through 模式缺少事务包裹——阿贝多标记为 🟠
- A3. ID 生成使用 Date.now() + 计数器——毫秒级时序竞态——阿贝多标记为 🟠
- A4. try-catch 风格发散（28+4+5+2 处）——莫娜标记为 4 种变体并存

簇 B：状态机流转不完整
- B1. AgentPool.destroy() 绕过 setStatus() 直写 Map——刻晴标记为 🟠 硬伤
- B2. setStatus() 返回 void——非法流转时调用方无法感知——阿贝多标记为 🟠
- B3. complete() 中 results 与 claimedBy 边界不同步——阿贝多标记为 🟠

讨论目标（严格按此顺序）：
1. 逐项判断：**必修**（Core-1 内闭）还是 **延后**（Core-2 再修）
2. 必修项必须给出 1 句话核心理由（禁止展开方案设计）
3. 延后项给出风险评估（延后到 Core-2 会造成什么后果）
4. 收束为「本轮必修清单」——不超过 5 项

发言格式：每项一条，格式为「A1: 必修/延后。理由：xxx」

收束要求：本轮结束时凝光输出「第一轮收束结论」，列出本轮必修项及其排期。`,
    },
    {
      title: "第二轮 · 工程债务与可观测管道——评估偿还优先级",
      minTurns: 5,
      maxTurns: 7,
      queryMode: "csa",
      topic: `【聚焦根因簇 C（可观测管道覆盖不全）+ D（基础设施/工程债务）】

⚠️ 约束：这是「优先级评估」会议，不是「重构设计」会议。每个发言必须给出「必修/可延后/已归因」的判断，
禁止提出新的架构方案。

待分类项：
簇 C：可观测管道覆盖不全
- C1. ButlerAgent._onNormal 空吞 NORMAL 优先级事件——刻晴标记为 🔴（已修复：移除 NORMAL 订阅 + 删除空方法）
- C2. observer.emit memory 域 6 次事件无消费者——莫娜标记为 🟡

簇 D：基础设施/工程债务
- D1. engine 23 源文件无同目录 __tests__/——纳西妲标记 🟡
- D2. llm-adapter + toolkit 无熔断降级——纳西妲标记 🟡
- D3. infra.ts 6 子域混杂——纳西妲标记 🟡
- D4. test-tmp.txt 未被 .gitignore——安柏标记 🟡
- D5. shared/dist/__tests__/ 测试产物混入构建——安柏标记 🟡
- D6. 根目录 webui/ 与 doc-govern/ 目录整理——安柏标记

讨论目标（严格按此顺序）：
1. 逐项判断：**必须 Core-2 前偿还** / **Core-2 中逐步解决** / **已归因无需修复**
2. 特别注意：纳西妲提到的「llm-adapter + toolkit 无熔断」——DeepSeek 4.1 发布后调用量将暴增，没有熔断是单点故障
3. 收束为「Core-2 前必修工程债」——不超过 4 项

发言格式：每项一条，格式为「D2: 必修。理由：xxx」或「D3: 延后。风险：xxx」

收束要求：本轮结束时凝光输出「第二轮收束结论」，更新优先级矩阵。`,
    },
    {
      title: "第三轮 · 模式债务 + DeepSeek 4.1 多模态——宪法演进讨论",
      minTurns: 5,
      maxTurns: 7,
      queryMode: "hca",
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
// 软约束共识圆桌配置（2026-05-11 合入）
//
// 流程：软约束自审视（7 Agent 自由探索）→ 本圆桌（硬约束共识）
//       → 产出 consensus-fix-list.md → 供下一轮硬约束验证使用
//
// 与 CODE_REVIEW_ROUNDTABLE 的区别：
//   - CODE_REVIEW_ROUNDTABLE 是根因簇深度讨论（设计走向、宪法演进）
//   - 本圆桌是纯粹的「分类决策」——从自由探索发现中提取可操作修复清单
// ═══════════════════════════════════════════════

export const SOFT_CONSENSUS_ROUNDTABLE: MeetingConfig = {
  name: "软约束共识圆桌", emoji: "\u{1F9EA}",
  background: `「Cortex 自审视 · 软约束共识圆桌」

Cortex 刚刚完成了软约束自由审视——9 位 Agent 在代码库中自由探索，各自从专业角度产出了审视报告。
这些报告包含：
  · 刻晴（⚡）：代码质量侦察——发现代码层面的具体缺陷
  · 阿贝多（⚗️）：核心层深度审查——持久化链路、状态机等核心模块
  · 纳西妲（🌿）：架构全景分析——依赖图、模块边界、扩展成本
  · 凝光（💎）：治理合规审计——声明与实际之间的偏差
  · 莫娜（🔮）：模式发现——隐藏的模式债务和趋势
  · 安柏（🐰）：全项目侦察——目录结构、配置异常
  · 北斗（⚓）：工程就绪诊断——构建、依赖、运行时脆弱点
  · 久岐忍（😈）：API 契约设计——模块边界与接口规范
  · 艾尔海森（📚）：数据层设计——类型体系与存储规范

现在，全体委员需要从这些自由探索的发现中，提取一份「可操作的共识修复清单」。
这不是设计讨论——这是分类决策。每一项发现需要回答：修不修？多急修？

制度：单轮合并圆桌
- 每人 3-5 次发言机会
- 一轮内完成陈述→交叉验证→凝光收束签署
- 禁止架构设计——只做分类
- 9 位 Agent 全体入席`,
  rounds: [
    {
      title: "发现陈述 + 共识签署（合并轮）",
      minTurns: 3,
      maxTurns: 5,
      queryMode: "hca",
      topic: `【基于各自审视报告，直接产出共识修复清单】

⚠️ 约束：一轮内完成全部流程。发言顺序：

第一阶段（第1次发言，所有人）：
  陈述你认为最关键的发现——每人最多 3 项，按严重度排序
  格式：「A. [严重度] 发现内容。理由：xxx」

第二阶段（第2次发言，所有人）：
  对他人的发现表态——同意/反对/补充。反对必须附理由。
  确认重复项（多人独立发现 → 升级），解明矛盾项（当场对质）。
  格式：「发现X: 必修/延后。理由：xxx」

第三阶段（第3-5次发言，凝光主导）：
  凝光收束全体表态，产出 P0-P3 共识修复清单：

## 审视共识修复清单（软约束 + 圆桌共识）

### P0 立即修复（阻断级——不修则下阶段无法推进）
- [ ] 文件/模块: 具体问题描述。发现者：某某。理由：xxx

### P1 高优先（Core-2 启动前必须完成）
- [ ] 文件/模块: 具体问题描述。发现者：某某。理由：xxx

### P2 重要（Core-2 期间修复）
- [ ] 文件/模块: 具体问题描述。发现者：某某。理由：xxx

### P3 改善（可延后但不应遗忘）
- [ ] 文件/模块: 具体问题描述。发现者：某某。理由：xxx

### ✅ 已确认无需修复
- ✅ xxx（理由）

定级原则：
- P0=阻断（数据静默损坏/observer缺失/CI缺失/安全漏洞）
- P1=高风险（竞态/配置冲突/行为不可预测）
- P2=可规划修复（工程债务/测试覆盖）
- P3=改善项（代码风格/日志优化/目录整理）

其他 Agent：审阅凝光的清单——
- 你的关键发现是否被正确记录和定级？
- 定级是否合理？如有遗漏或定级错误，必须在发言中明确指出。
- 如无异议，签署「确认」。

最终产出一份全员签署的共识修复清单。`,
    },
  ],

  personas: buildPersonas(personaPrompts).filter((p) => p.type !== AgentType.Browser),
};

// ═══════════════════════════════════════════════
// 归因分析圆桌——第二阶段 · 无主题会议（2026-05-04 入宪）
//
// 与前三轮圆桌不同——本会议不设固定议题。
// 材料：根因归簇分析报告（AI 归因引擎产出，将 206+ 发现归为 6 个根因簇）+ 钟离战略评估。
//
// Agent 的自由度：
//   - 没有预定义的「待分类项」——Agent 从归因报告中自己提取想讨论的点
//   - 没有强制性「必修/延后」判断——Agent 可以深入讨论任何一个根因簇的任意侧面
//   - 可以质疑归因报告本身的归簇逻辑——A 发现和 B 发现真的属于同一个根因吗？
//   - 可以讨论跨簇的关联——簇 C（可观测管道）和簇 A（持久化链路）之间有没有隐藏的因果链？
//   - 唯一的硬约束：发言必须有据——引用归因报告中的具体发现编号或审视报告中的原文
//
// 制度：单轮开放讨论（无 maxTurns 硬顶，质量不足自动终止）
//   - 凝光不事先设定议题，由 Agent 自发展开
//   - 凝光在讨论过程中动态记录共识点和分歧点
//   - 讨论自然收束后，凝光输出「归因共识纪要」
// ═══════════════════════════════════════════════

export const ATTRIBUTION_ROUNDTABLE: MeetingConfig = {
  name: "归因分析圆桌", emoji: "\u{1F9EA}",
  background: `「Cortex 自审视 · 归因分析圆桌——第二阶段·无主题」

第一阶段的软约束共识圆桌已经完成了「发现→分类→修复清单」的标准流程。
但现在桌上多了一份新文件：根因归簇分析报告。

这不是另一份审视报告——这是 AI 归因分析引擎跨报告去重后产出的根因地图。
206+ 项发现归为 6 个根因簇，每个簇标注了发生频率、影响范围、修复成本估算。

这份报告是全新的——前三轮圆桌时它还不存在。
现在，审视委员会需要面对它。

制度：第二阶段 · 无主题圆桌
- 没有预设议题——Agent 从归因报告中自己提取想讨论的点
- 没有必须回答的问题——可以深入任何一个根因簇的任何侧面
- 发言必须有据——引用归因报告中的具体发现编号或审视报告中的原文
- 凝光动态记录共识点和分歧点，讨论自然收束后输出「归因共识纪要」
- 10 位 Agent 全体入席（第一阶段圆桌参与者的知识延续）`,

  rounds: [
    {
      title: "开放讨论 · 根因归簇审视",
      minTurns: 3,
      maxTurns: 8,
      queryMode: "hca",
      topic: `【无预设议题——从归因报告中自由展开】

桌上有一份「根因归簇分析报告」——AI 归因引擎将 206+ 项发现归为 6 个根因簇：
  簇 A：持久化链路防御不足
  簇 B：状态机流转不完整
  簇 C：可观测管道覆盖不全
  簇 D：基础设施/工程债务
  簇 E：代码模式债务
  簇 F：治理合规偏差（已归因）

你可以：
1. 选择任何一个根因簇深入讨论——为什么这些问题会聚合成这个根因？归因逻辑是否站得住？
2. 质疑归簇——某条发现被归入簇 A，但它真的是持久化问题吗？还是状态机问题的另一个表现？
3. 发现跨簇关联——簇 C 的可观测盲区是不是导致簇 A 的持久化缺陷一直没被发现的原因？
4. 提出归因报告遗漏的维度——有没有哪类问题散落在多份审视报告中，但没有被归因引擎识别为独立簇？
5. 讨论修复优先级——根因视角下的修复顺序和第一轮圆桌的「按发现定级」有没有冲突？

⚠️ 唯一硬约束：发言必须有据。
- 引用归因报告时标注发现编号（如 A1, B2, C1）
- 引用审视报告时标注 Agent 名 + 报告章节
- 不要凭空发挥——你的每一个观点都要在材料中找得到锚点

凝光的任务：
- 不设定议题，不引导方向——让讨论自然展开
- 动态记录共识点（多人认同的判断）和分歧点（对同一归簇的不同解读）
- 讨论自然收束后，输出「归因共识纪要」——不是修复清单，而是对根因地图的集体确认或修正`,
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

/**
 * 从共识修复清单文本中提取 P0-P3 条目。
 * 用于共识晋升——将圆桌产出的修复项写入 Conceptual 记忆。
 */
function extractConsensusItems(consensusText: string): Array<{ priority: string; description: string }> {
  const items: Array<{ priority: string; description: string }> = [];
  // 匹配 P0/P1/P2/P3 节中的 - [ ] 或 - [x] 条目
  const sectionRegex = /### (P[0-3])[\s\S]*?(?=###|$)/g;
  let sectionMatch;
  while ((sectionMatch = sectionRegex.exec(consensusText)) !== null) {
    const priority = sectionMatch[1];
    const sectionBody = sectionMatch[0];
    // 提取该节中的所有 - [ ] / - [x] 条目
    const itemRegex = /^[-*]\s*\[[ x]\]\s*(.+)$/gm;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(sectionBody)) !== null) {
      const desc = itemMatch[1].trim();
      if (desc.length > 10) {
        items.push({ priority, description: desc });
      }
    }
  }
  return items;
}

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

export interface SeedMemory {
  memoryType: MemoryType;
  content: Record<string, unknown>;
  summary: string;
  agentType: AgentType;
  creatorId: string;
  weight?: number;
}

export async function runMeeting(
  config: MeetingConfig,
  adapter: LlmAdapter,
  chatModel: string,
  dbDir: string,
  consensusOutputPath?: string,
  seedMemories?: SeedMemory[],
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

    // 种子记忆注入：在会议开始前将审视报告摘要写入 MemoryStore
    if (seedMemories && seedMemories.length > 0) {
      console.log(`  🌱 注入 ${seedMemories.length} 条种子记忆...`);
      for (const seed of seedMemories) {
        memory.write({
          memoryType: seed.memoryType,
          content: seed.content,
          summary: seed.summary,
          agentType: seed.agentType,
          creatorId: seed.creatorId,
          weight: seed.weight ?? 5,
        });
      }
      console.log(`  ✅ 种子记忆注入完成\n`);
    }

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
          // ── 关键词快速 PASS：persona 领域与 topic 无交集时跳过 LLM ──
          const topicLower = round.topic.toLowerCase();
          const KW_MAP: Record<string, string[]> = {
            Code: ["code", "deep", "bug", "logic", "function", "class", "module", "type-check", "compile"],
            Review: ["review", "quality", "code", "bug", "anti-pattern", "style", "defect"],
            Ops: ["ops", "build", "ci", "deploy", "dependency", "config", "runtime", "test", "shell", "readiness"],
            Analysis: ["analysis", "architecture", "dependency", "module", "boundary", "design", "pattern", "extension"],
            DocGovern: ["govern", "doc", "audit", "compliance", "constitution", "rule", "policy", "declaration"],
            Loop: ["pattern", "trend", "memory", "skill", "learning", "discovery", "repeat"],
            Inspector: ["inspect", "directory", "file", "structure", "git", "config", "missing", "anomaly", "recon"],
            Api: ["api", "contract", "interface", "signature", "boundary", "export", "import", "type-safe", "design"],
            Data: ["data", "schema", "serialization", "storage", "consistency", "naming", "field", "model"],
          };
          const agentKws = KW_MAP[persona.type] ?? [];
          const hasRelevance = agentKws.length === 0 || agentKws.some((kw) => topicLower.includes(kw));

          if (!hasRelevance) {
            console.log(`  ${persona.emoji} ${persona.name} [${turn}]: ⏭️ 关键词无交集，自动PASS`);
            roundSpeeches.push({ turn, speaker: persona.name, said: false, chars: 0, preview: "" });
            continue;
          }

          // ── DSA 稀疏注意力：按轮次 queryMode 决定读取广度/深度 ──
          const recentMems = memory.read({
            memoryTypes: [MemoryType.Episodic, MemoryType.Knowledge],
            queryMode: round.queryMode ?? 'csa',
          } as any);

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
            `📋 话题: ${round.topic}`,
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

      // ── 轮间上下文重置：将本轮要点压缩为 Conceptual 记忆 ──
      // HCA 轮（广度浅读）产生大量观察 → 压缩为要点摘要
      // CSA 轮（深度窄读）产生聚焦结论 → 压缩为决策锚点
      // 下一轮 Agent 读取记忆时，DSA queryMode 决定看到摘要还是细节
      const roundMode = round.queryMode ?? 'csa';
      const saidSpeeches = roundSpeeches.filter((s) => s.said && s.chars > 40);
      if (saidSpeeches.length > 0) {
        const roundDigest = saidSpeeches
          .map((s) => `[${s.speaker} R${ri + 1}T${s.turn}] ${s.preview.slice(0, 150)}`)
          .join("\n");
        memory.write({
          memoryType: MemoryType.Conceptual,
          content: {
            round: ri + 1,
            title: round.title,
            mode: roundMode,
            substantiveSpeeches: saidSpeeches.length,
            totalSpeeches: roundSpeeches.filter((s) => s.said).length,
            digest: roundDigest,
          },
          summary: `[轮次收束:${config.name}] R${ri + 1} ${round.title} (${roundMode.toUpperCase()}) — ${saidSpeeches.length} 次实质发言`,
          agentType: AgentType.Meta,
          creatorId: "system",
          weight: roundMode === 'hca' ? 4 : 7,
        });
        console.log(`  🔄 上下文重置: R${ri + 1} 收束 → Conceptual (${roundMode.toUpperCase()}, weight=${roundMode === 'hca' ? 4 : 7})`);
      }
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
      // 取凝光所有轮次中实际的最大轮号（而非 config.rounds.length，
      // 因为单轮配置在 maxTurns>1 时会展开为多轮）
      const allRounds = allMems
        .filter((m: any) => m.memoryType === MemoryType.Episodic)
        .map((m: any) => m.content?.round ?? 0);
      const finalRound = allRounds.length > 0 ? Math.max(...allRounds) : config.rounds.length;
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

        // ── 共识晋升：P0-P3 修复项 → CONCEPTUAL 记忆 ──
        // FSA 闭环：共识产出（Episodic 讨论）晋升为 Conceptual（持久知识），
        // 链接到凝光的收束发言和全体参会 Agent 的实质贡献。
        const promotedItems = extractConsensusItems(speechText);
        if (promotedItems.length > 0) {
          console.log(`  🧠 共识晋升: ${promotedItems.length} 项 P0-P3 条目 → Conceptual 记忆`);
          for (const item of promotedItems) {
            const memId = memory.write({
              memoryType: MemoryType.Conceptual,
              content: {
                taskType: "consensus-fix-item",
                priority: item.priority,
                description: item.description,
                source: config.name,
                round: finalRound,
              },
              summary: `[共识修复:${item.priority}] ${item.description.slice(0, 120)}`,
              agentType: AgentType.DocGovern,
              creatorId: "凝光",
              weight: item.priority === "P0" ? 10 : item.priority === "P1" ? 8 : item.priority === "P2" ? 6 : 4,
            });
            // FSA 反馈：共识产出链接到凝光的收束发言
            if (lastSpeech) {
              memory.link(memId, (lastSpeech as any).id, LinkType.DerivedFrom, "system");
            }
            // 链接到全体参会 Agent 的最后一轮实质发言（ConfirmedUseful）
            const lastRoundEpisodic = allMems.filter(
              (m: any) =>
                m.memoryType === MemoryType.Episodic &&
                m.content?.round === finalRound &&
                String(m.content?.speech ?? "").length > 40
            );
            for (const epiMem of lastRoundEpisodic.slice(0, 10)) {
              memory.link(memId, (epiMem as any).id, LinkType.ConfirmedUseful, "system");
            }
          }
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
